'use strict'

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, dialog, nativeImage } = require('electron')
const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { Metrics } = require('./metrics')
const { WindowWatcher } = require('./window-watcher')
const { createCrabIcon } = require('./tray-icon')

const APP_NAME = 'Monitor-CPU'
// 改名前用過的設定資料夾；新資料夾還沒有設定檔時，會從這裡複製一份過來
const LEGACY_DATA_DIRS = ['crab-monitor']

// 設定資料夾固定叫 Monitor-CPU，不隨 package.json 的 name 或打包工具的預設而變。
// 單一執行個體鎖也是跟著這個資料夾走，所以要在 requestSingleInstanceLock 之前設定。
app.setName(APP_NAME)
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME))

// ---------------------------------------------------------------- 繪圖方式

/**
 * 吉祥物是一片透明視窗，每畫一格 Windows 都要重新合成整片視窗。用顯示卡畫的話，內建顯示卡
 * 光這個程式就要用掉約一成的 GPU；改成用 CPU 畫（關掉硬體加速），GPU 大約再省一半，
 * 代價是 CPU 多用一點（20 個邏輯核心的桌機上大約半顆核心）。
 *
 * 'auto' 依邏輯核心數決定：核心夠多 CPU 多用一點感覺不到，就省 GPU；核心少（入門款筆電）就用顯示卡。
 * 硬體加速只能在程式啟動前決定，所以這裡先直接讀設定檔，改了要重新啟動才會生效。
 */
const RENDER_AUTO_MIN_CORES = 8

function readRenderModeEarly() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'))
    return ['auto', 'cpu', 'gpu'].includes(raw.renderMode) ? raw.renderMode : 'auto'
  } catch (_) {
    return 'auto'
  }
}

function decideRender(mode) {
  const cores = os.cpus().length
  const auto = cores >= RENDER_AUTO_MIN_CORES ? 'cpu' : 'gpu'
  return { mode, cores, auto, active: mode === 'auto' ? auto : mode, minCores: RENDER_AUTO_MIN_CORES }
}

const startupRender = decideRender(readRenderModeEarly())
if (startupRender.active === 'cpu') app.disableHardwareAcceleration()

const BAR_HEIGHT = 360 // 視窗高度：吉祥物 + 上方的數值氣泡 + 被拖起來或小鳥飛起來的空間

const DEFAULTS = {
  source: 'cpu',          // 'cpu' | 'gpu' | 'max'
  showLabel: true,
  scale: 1,
  displayId: null,        // null = 主螢幕
  startOnLogin: false,
  mascot: 'crab',         // MASCOTS 裡的其中一個
  roamScreen: false,      // 可以在整個畫面活動（每種吉祥物都適用）；關掉就只在底下的工具列上
  perchWindows: true,     // 整個畫面活動時可以到其他視窗上（小鳥停標題列、螃蟹爬上去）
  showCrab: true,         // 在桌面（工具列上）顯示吉祥物
  showTray: true,         // 小圖示直接顯示在時鐘旁邊；關掉的話收進 ^ 裡面（圖示一直都在，才找得到設定）
  renderMode: 'auto',     // 繪圖方式：'auto' 依核心數自動選 | 'cpu' 省 GPU（關掉硬體加速）| 'gpu' 用顯示卡；重新啟動才生效
  promotedTrayPaths: [],  // 已經自動設成「直接顯示在右下角」過的 exe 路徑
  salmonEgg: null,        // 彩蛋：黑熊吃掉鮭魚後留下的魚卵 { hatchAt: 孵化時間(ms), x: 螢幕座標 | null }，孵化前不能選鮭魚
}

// 有哪些吉祥物。新增動物時加在這裡，畫法與動作寫在 renderer，設定視窗的說明寫在 settings.js 的 MASCOTS
const MASCOTS = ['crab', 'bird', 'bear', 'spoonbill', 'turtle', 'pangolin', 'salmon', 'dolphin']
// 水生動物不會到其他視窗上，選牠們的時候不用盯著其他視窗
const NO_WINDOW_MASCOTS = ['turtle', 'salmon', 'dolphin']
// 系統匣圖示：螃蟹跟著負載變色、小鳥搖頭動畫，其他動物用 window.MascotArt[id].renderIcon 畫一張固定的
const STATIC_TRAY_MASCOTS = MASCOTS.filter((id) => id !== 'crab' && id !== 'bird')

// 設定視窗送來的值要先檢查，壞掉的值不能寫進設定檔
const isBool = (v) => typeof v === 'boolean'
const SETTING_RULES = {
  source: (v) => ['cpu', 'gpu', 'max'].includes(v),
  mascot: (v) => MASCOTS.includes(v) && !(v === 'salmon' && config.salmonEgg), // 魚卵還沒孵化不能選鮭魚
  roamScreen: isBool,
  renderMode: (v) => ['auto', 'cpu', 'gpu'].includes(v),
  scale: (v) => typeof v === 'number' && v >= 0.5 && v <= 2,
  displayId: (v) => v === null || screen.getAllDisplays().some((d) => d.id === v),
  perchWindows: isBool,
  showLabel: isBool,
  showCrab: isBool,
  showTray: isBool,
  startOnLogin: isBool,
}

// 系統匣圖示每 5% 一種顏色；Windows 在 100% / 150% / 200% 縮放下分別要 16 / 24 / 32px
const TRAY_BUCKETS = Array.from({ length: 21 }, (_, i) => i * 5)
const TRAY_SCALES = [[1, 16], [1.5, 24], [2, 32]]
// 右下角的小鳥是搖頭動畫（桌面上的小鳥不搖頭）：一個搖頭週期畫成幾張，依負載換張的速度
const BIRD_FRAMES = 8
const BIRD_CYCLES_PER_SEC = [0.6, 2.5] // 0% 與 100% 負載時每秒搖幾個週期

// 圖示第一次出現後 Explorer 才會建立它的紀錄，所以分幾次、越等越久去找
const PROMOTE_RETRY_MS = [1500, 3000, 6000, 12000, 20000]
const CURSOR_POLL_MS = 100 // 多久讀一次游標位置（滑鼠鉤子收不到移動時的備案，見 startCursorPoll）

let win = null
let settingsWin = null
let tray = null
let metrics = null
let lastMetrics = null
let config = { ...DEFAULTS }
let lastIconLoad = -1
let currentLoad = 0
let interactive = false
let menuOpen = false // 吉祥物身上的右鍵選單開著
let expanded = false // 拖曳中：視窗展開成涵蓋所有螢幕
let layout = null // 最後一次算出的視窗尺寸與工具列高度；renderer 太晚載入來不及收 layout 事件時主動來問
let promoteTimer = null
const trayIcons = new Map()
const birdIcons = []
const staticIcons = new Map()
let birdFrame = 0
let birdTimer = null
const windowWatcher = new WindowWatcher()
let lastPerchesJson = ''

const configPath = () => path.join(app.getPath('userData'), 'settings.json')

function migrateLegacySettings() {
  if (fs.existsSync(configPath())) return
  for (const dir of LEGACY_DATA_DIRS) {
    const legacy = path.join(app.getPath('appData'), dir, 'settings.json')
    if (!fs.existsSync(legacy)) continue
    try {
      fs.mkdirSync(path.dirname(configPath()), { recursive: true })
      // 用複製不用搬移：舊版 exe 如果還在用，它的設定不會不見
      fs.copyFileSync(legacy, configPath())
    } catch (_) { /* 搬不過來就用預設值 */ }
    return
  }
}

function loadConfig() {
  migrateLegacySettings()
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    config = { ...DEFAULTS, ...raw }
    // 舊版的活動範圍叫 flyMode（'bar' | 'free'），換成通用的開關
    if (raw.roamScreen === undefined && raw.flyMode !== undefined) config.roamScreen = raw.flyMode === 'free'
    delete config.flyMode
  } catch (_) {
    config = { ...DEFAULTS }
  }
  if (!MASCOTS.includes(config.mascot)) config.mascot = DEFAULTS.mascot
  const egg = config.salmonEgg
  if (!egg || typeof egg.hatchAt !== 'number' || egg.hatchAt <= Date.now()) config.salmonEgg = null // 關著的時候孵化了
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true })
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2))
  } catch (_) { /* 設定存不起來不是致命問題 */ }
}

/** probe.ps1 在開發時在 src 裡，打包後被放到 resources 下。 */
function probeScriptPath() {
  const packed = path.join(process.resourcesPath || '', 'probe.ps1')
  if (process.resourcesPath && fs.existsSync(packed)) return packed
  return path.join(__dirname, 'probe.ps1')
}

/** 可以在整個畫面活動：視窗蓋滿整台螢幕，而不是只有底部一條。每種吉祥物都適用。 */
function freeRoam() {
  return !!config.roamScreen
}

function targetDisplay() {
  const displays = screen.getAllDisplays()
  if (config.displayId !== null) {
    const found = displays.find((d) => d.id === config.displayId)
    if (found) return found
  }
  return screen.getPrimaryDisplay()
}

function positionWindow() {
  if (!win || win.isDestroyed()) return
  const d = targetDisplay()
  const all = screen.getAllDisplays()
  let bounds
  if (expanded) {
    // 拖曳中：視窗涵蓋所有螢幕，才能拖到別台、也不限制往上抬多高
    const left = Math.min(...all.map((x) => x.bounds.x))
    const top = Math.min(...all.map((x) => x.bounds.y))
    const right = Math.max(...all.map((x) => x.bounds.x + x.bounds.width))
    const bottom = Math.max(...all.map((x) => x.bounds.y + x.bounds.height))
    // 四邊各內縮 1 像素：置頂視窗完整蓋住一整台螢幕時，Windows 會當成有全螢幕程式，
    // 把工具列收起來又放出來（看起來像工具列跳一下）
    bounds = { x: left + 1, y: top + 1, width: right - left - 2, height: bottom - top - 2 }
  } else if (freeRoam()) {
    // 整個螢幕：整台螢幕都是吉祥物的，平常一樣整片穿透，不會擋到任何東西
    bounds = { ...d.bounds }
  } else {
    // 用 bounds 而不是 workArea：我們要蓋在工具列上面，不是停在工具列上方。
    bounds = {
      x: d.bounds.x,
      y: d.bounds.y + d.bounds.height - BAR_HEIGHT,
      width: d.bounds.width,
      height: BAR_HEIGHT,
    }
  }
  win.setBounds(bounds)
  // 每台螢幕的範圍與地面（座標換成視窗內座標）。地面 = 工作區底部，也就是工具列上緣；
  // 工具列在別邊或自動隱藏時工作區底部等於螢幕底部，吉祥物就直接站在螢幕底部。
  layout = {
    width: bounds.width,
    height: bounds.height,
    originX: bounds.x,
    originY: bounds.y,
    expanded,
    free: freeRoam(),
    homeId: d.id,
    displays: all.map((x) => ({
      id: x.id,
      left: x.bounds.x - bounds.x,
      right: x.bounds.x + x.bounds.width - bounds.x,
      top: x.bounds.y - bounds.y,
      bottom: x.bounds.y + x.bounds.height - bounds.y,
      ground: x.workArea.y + x.workArea.height - bounds.y,
    })),
  }
  win.webContents.send('layout', layout)
}

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: BAR_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,     // 不搶焦點，點到也不會讓目前的視窗失焦
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 否則被遮住時動畫會停
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver') // 這個層級才會蓋在 Windows 工具列上
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true }) // 預設整片穿透，工具列照常可用

  // 畫面是透明且點不到的，出問題時看起來就只是「什麼都沒有」，
  // 所以把 renderer 的錯誤轉印到終端機，不然很難查。
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer] ${source}:${line} ${message}`)
  })
  win.webContents.on('preload-error', (_e, file, err) => {
    console.error(`[preload] ${file}`, err)
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[load failed] ${code} ${desc}`)
  })

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))

  win.once('ready-to-show', () => {
    win.webContents.send('config', config)
    applyCrabVisibility()
    prepareTrayIcons()
      .then(() => applyTrayMascot())
      .catch((err) => console.error('[tray] 畫系統匣圖示失敗，繼續使用備用圖示：', err))
  })
}

// ---------------------------------------------------------------- 其他視窗（小鳥停的標題列、螃蟹爬的外框）

/** 只有在整個螢幕模式、而且開了「到其他視窗上」時才需要盯著其他視窗（水生動物不會到其他視窗上）。 */
function applyWindowWatcher() {
  const want = freeRoam() && config.perchWindows && config.showCrab && !NO_WINDOW_MASCOTS.includes(config.mascot)
  if (want && win && !win.isDestroyed()) {
    // 告訴偵測程序吉祥物視窗是哪一個，只排除它（設定視窗要照實際的前後順序算進去）
    const h = win.getNativeWindowHandle()
    windowWatcher.excludeHwnd = (h.length >= 8 ? h.readBigUInt64LE(0) : BigInt(h.readUInt32LE(0))).toString()
  }
  if (want) windowWatcher.start()
  else windowWatcher.stop()
}

/** [a, b] 區間扣掉 [c, d]。 */
function subtractRange(segs, c, d) {
  const out = []
  for (const [a, b] of segs) {
    if (d <= a || c >= b) {
      out.push([a, b])
      continue
    }
    if (c > a) out.push([a, c])
    if (d < b) out.push([d, b])
  }
  return out
}

/**
 * 視窗清單（實體像素、最上層的在前）→ 換成螢幕 DIP 座標的外框（螃蟹沿著爬），
 * 以及可以站的上緣線段（小鳥降落、螃蟹跳下去落腳）。
 * 上緣被上層視窗蓋住的那一段扣掉，不然會看起來停在別的視窗中間。
 */
function computeWindowShapes(list) {
  const rects = list.map((w) => {
    const phys = { x: w.l, y: w.t, width: w.r - w.l, height: w.b - w.t }
    let r = phys
    try { r = screen.screenToDipRect(null, phys) } catch (_) { /* 換不了就當作 100% 縮放 */ }
    return { id: w.id, x: r.x, y: r.y, w: r.width, h: r.height }
  })
  const perches = []
  rects.forEach((w, i) => {
    let segs = [[w.x, w.x + w.w]]
    for (let j = 0; j < i && segs.length; j++) {
      const o = rects[j]
      if (o.y > w.y + 1 || o.y + o.h < w.y) continue
      segs = subtractRange(segs, o.x, o.x + o.w)
    }
    for (const [x1, x2] of segs) {
      if (x2 - x1 >= 60) {
        perches.push({ id: w.id, wx: Math.round(w.x), y: Math.round(w.y), x1: Math.round(x1), x2: Math.round(x2) })
      }
    }
  })
  const windows = rects.map((w) => ({ id: w.id, x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.w), h: Math.round(w.h) }))
  return { perches, windows }
}

windowWatcher.on('windows', (list) => {
  const shapes = computeWindowShapes(list)
  const json = JSON.stringify(shapes)
  if (json === lastPerchesJson) return
  lastPerchesJson = json
  if (win && !win.isDestroyed()) win.webContents.send('perches', shapes)
})

// ---------------------------------------------------------------- 系統匣圖示

/**
 * 系統匣圖示跟工具列上的螃蟹用同一份 crab.js 畫法：趁螃蟹視窗載入好，
 * 一次把 21 種顏色 × 3 種解析度畫好快取起來。視窗隱藏時一樣能畫。
 * 還沒畫好、或畫失敗時，trayImage() 會退回 tray-icon.js 的點陣版本，
 * 確保系統匣入口無論如何都存在。
 */
async function prepareTrayIcons() {
  const sizes = TRAY_SCALES.map(([, px]) => px)
  const script = `(() => {
    const crab = {}
    for (const b of ${JSON.stringify(TRAY_BUCKETS)}) {
      const hue = window.CrabArt.loadToHue(b)
      crab[b] = ${JSON.stringify(sizes)}.map((px) => window.CrabArt.renderIcon(px, hue))
    }
    const bird = []
    for (let i = 0; i < ${BIRD_FRAMES}; i++) {
      bird.push(${JSON.stringify(sizes)}.map((px) => window.BirdArt.renderIcon(px, i / ${BIRD_FRAMES})))
    }
    const statics = {}
    for (const id of ${JSON.stringify(STATIC_TRAY_MASCOTS)}) {
      const art = (window.MascotArt || {})[id]
      if (art) statics[id] = ${JSON.stringify(sizes)}.map((px) => art.renderIcon(px))
    }
    return { crab, bird, statics }
  })()`
  const { crab, bird, statics } = await withTimeout(win.webContents.executeJavaScript(script), 5000)
  const toImage = (urls) => {
    const img = nativeImage.createEmpty()
    TRAY_SCALES.forEach(([scaleFactor], i) => img.addRepresentation({ scaleFactor, dataURL: urls[i] }))
    return img
  }
  for (const b of TRAY_BUCKETS) trayIcons.set(b, toImage(crab[b]))
  birdIcons.length = 0
  bird.forEach((urls) => birdIcons.push(toImage(urls)))
  for (const [id, urls] of Object.entries(statics)) staticIcons.set(id, toImage(urls))
}

/** 這隻吉祥物用固定圖示的話回傳那張圖示（還沒畫好就是 null，先用螃蟹的頂著）。 */
function staticTrayIcon() {
  return STATIC_TRAY_MASCOTS.includes(config.mascot) ? staticIcons.get(config.mascot) || null : null
}

/** 設定視窗等地方要用的「目前吉祥物」圖示。 */
function mascotIcon() {
  if (config.mascot === 'bird' && birdIcons.length) return birdIcons[0]
  return staticTrayIcon() || trayImage(0)
}

function bucketOf(load) {
  return Math.round(Math.max(0, Math.min(100, load || 0)) / 5) * 5
}

function trayImage(bucket) {
  return trayIcons.get(bucket) || createCrabIcon(bucket)
}

function refreshTrayIcon(load) {
  if (!tray || config.mascot !== 'crab') return // 只有螃蟹跟著負載變色；小鳥用計時器換張，其他動物是固定的一張
  const bucket = bucketOf(load)
  if (bucket === lastIconLoad) return
  lastIconLoad = bucket
  tray.setImage(trayImage(bucket))
}

/** 小鳥搖頭：一張接一張換，負載越高換得越快。 */
function tickBirdIcon() {
  clearTimeout(birdTimer)
  birdTimer = null
  if (!tray || config.mascot !== 'bird') return
  if (birdIcons.length) {
    birdFrame = (birdFrame + 1) % birdIcons.length
    tray.setImage(birdIcons[birdFrame])
  }
  const t = Math.max(0, Math.min(1, currentLoad / 100))
  const [slow, fast] = BIRD_CYCLES_PER_SEC
  const cyclesPerSec = slow + (fast - slow) * t
  birdTimer = setTimeout(tickBirdIcon, Math.round(1000 / (cyclesPerSec * BIRD_FRAMES)))
}

/** 換吉祥物、或系統匣重新建立後，讓圖示回到對的樣子。 */
function applyTrayMascot() {
  clearTimeout(birdTimer)
  birdTimer = null
  if (!tray) return
  if (config.mascot === 'bird') {
    tickBirdIcon()
  } else if (staticTrayIcon()) {
    tray.setImage(staticTrayIcon())
  } else {
    lastIconLoad = -1
    refreshTrayIcon(currentLoad)
  }
}

function createTray() {
  lastIconLoad = -1
  tray = new Tray(trayImage(bucketOf(currentLoad)))
  tray.setToolTip(APP_NAME)
  tray.setContextMenu(buildMenu())
  tray.on('click', openSettings) // 左鍵直接開設定，右鍵才是選單
  applyTrayMascot()

  clearTimeout(promoteTimer)
  promoteTimer = setTimeout(() => syncTrayPromotion(0, false), PROMOTE_RETRY_MS[0])
}

function destroyTray() {
  clearTimeout(promoteTimer)
  clearTimeout(birdTimer)
  birdTimer = null
  if (tray) tray.destroy()
  tray = null
}

// ---------------------------------------------------------------- 右下角直接顯示 / 收進 ^

/**
 * Windows 11 預設把新程式的系統匣圖示收進 ^ 箭頭裡，要使用者自己到
 * 「設定 → 個人化 → 工作列 → 其他系統匣圖示」打開。那個開關其實就是
 * HKCU\Control Panel\NotifyIconSettings\<id> 底下的 IsPromoted（1 直接顯示、0 收進 ^），
 * 每筆紀錄用 ExecutablePath 對應到 exe。
 *
 * 系統匣圖示一直都在，設定裡的「在右下角顯示小圖示」決定 IsPromoted：
 * 每個 exe 位置第一次啟動時照設定改一次，之後使用者若在 Windows 設定裡自己改了，就尊重他的選擇；
 * 只有在設定視窗切換這個選項時才會再改。Windows 10 用的是另一種二進位格式，找不到紀錄就放棄。
 *
 * exe 路徑和要改成的值用環境變數傳進去，使用者名稱是中文的電腦也不會有編碼問題。
 */
const PROMOTE_TRAY_PS = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$exe = $env:MONITOR_CPU_EXE',
  '$want = [int]$env:MONITOR_CPU_PROMOTE',
  "$result = 'notfound'",
  "foreach ($key in Get-ChildItem 'HKCU:\\Control Panel\\NotifyIconSettings') {",
  '  $p = Get-ItemProperty $key.PSPath',
  '  if ($p.ExecutablePath -and $p.ExecutablePath -eq $exe) {',
  "    if ([int]$p.IsPromoted -eq $want) { if ($result -eq 'notfound') { $result = 'already' } }",
  "    else { Set-ItemProperty $key.PSPath -Name IsPromoted -Value $want -Type DWord; $result = 'changed' }",
  '  }',
  '}',
  '$result',
].join('\n')

/**
 * 轉成長檔名。portable exe 解壓到 %TEMP% 執行，使用者資料夾名稱有空白之類的時候，
 * process.execPath 會是 8.3 短檔名（C:\Users\WINDOW~1\...），但 Windows 的系統匣紀錄存的是長檔名，
 * 直接比對會永遠找不到。
 */
function longPath(p) {
  try {
    return fs.realpathSync.native(p)
  } catch (_) {
    return p
  }
}

/**
 * 照「在右下角顯示小圖示」改 Windows 的紀錄。force 是設定視窗剛切換過（一定要改）；
 * 不是的話（啟動時）這個 exe 位置已經改過一次就不再動，尊重使用者在 Windows 設定裡的選擇。
 * promotedTrayPaths 記的是「已經照設定改過一次」的 exe 位置（名稱沿用舊版）。
 */
function syncTrayPromotion(attempt, force) {
  if (process.platform !== 'win32' || !tray) return
  const exe = longPath(process.execPath)
  const known = (config.promotedTrayPaths || []).some((p) => p.toLowerCase() === exe.toLowerCase())
  if (known && !force) return

  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PROMOTE_TRAY_PS, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15000, env: { ...process.env, MONITOR_CPU_EXE: exe, MONITOR_CPU_PROMOTE: config.showTray ? '1' : '0' } },
    (_err, stdout) => {
      const result = String(stdout || '').trim()
      if (result === 'changed' || result === 'already') {
        if (!known) update({ promotedTrayPaths: [...(config.promotedTrayPaths || []), exe] })
        // 剛改好的話重新掛一次圖示，Explorer 重新登記時就會照新設定顯示或收進 ^
        if (result === 'changed' && tray) {
          destroyTray()
          createTray()
        }
      } else if (attempt + 1 < PROMOTE_RETRY_MS.length) {
        promoteTimer = setTimeout(() => syncTrayPromotion(attempt + 1, force), PROMOTE_RETRY_MS[attempt + 1])
      }
    }
  )
}

// ---------------------------------------------------------------- 開機自動啟動

/**
 * 開機時要執行的程式。
 *
 * 之前直接用 process.execPath，但 portable exe 執行時其實是先解壓到暫存資料夾、
 * 再從那裡跑，所以 execPath 是暫存資料夾裡的那份；登出後暫存檔被清掉，
 * 開機時登錄檔指向的檔案已經不在了，看起來就是「沒有自動啟動」。
 * electron-builder 會把使用者實際點的那個 exe 放在 PORTABLE_EXECUTABLE_FILE。
 *
 * 開發時（npm start）execPath 是 electron.exe，要把專案路徑當參數。
 *
 * 另外 Electron 寫進登錄檔時不會幫路徑加引號。路徑裡有空白（例如使用者名稱是
 * 「windows user」）的話，Windows 開機時會在空白處切斷、去找 C:\Users\windows，
 * 一樣什麼都不會啟動，所以 exe 路徑和參數都要自己加引號。
 */
function loginItemOptions() {
  const quote = (s) => (/^".*"$/.test(s) ? s : `"${s}"`)
  const portable = process.env.PORTABLE_EXECUTABLE_FILE
  if (portable) return { path: quote(portable), args: [] }
  if (!app.isPackaged) return { path: quote(process.execPath), args: [quote(app.getAppPath())] }
  return { path: quote(process.execPath), args: [] }
}

/** 啟動時也套用一次：exe 被搬到別的地方後，登錄檔裡的路徑會跟著更新。 */
function applyLoginItem() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return
  try {
    // 舊版用預設名稱寫入、路徑又是暫存資料夾，先清掉，免得留下一筆壞掉的紀錄
    if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: false })
    app.setLoginItemSettings({ openAtLogin: !!config.startOnLogin, name: APP_NAME, ...loginItemOptions() })
  } catch (err) {
    console.error('[login item] 設定開機自動啟動失敗：', err)
  }
}

// ---------------------------------------------------------------- 顯示開關

function setInteractive(next) {
  if (!win || win.isDestroyed() || next === interactive) return
  interactive = next
  win.setIgnoreMouseEvents(!next, { forward: true })
}

/**
 * 穿透中的視窗靠 Electron 的全域滑鼠鉤子才知道游標移上來。但前景是系統管理員權限的視窗
 * （例如工作管理員、有些遊戲）時，Windows 不讓一般權限程式的鉤子收到滑鼠移動，
 * 吉祥物就不會接管滑鼠、也不會顯示數值。讀游標位置不受這個限制，所以另外定期讀，
 * 游標在視窗範圍內而且有移動就轉給 renderer，由它判斷是不是在吉祥物身上；離開視窗範圍時送一次 null。
 * 接管滑鼠之後也要繼續讀：那種情況下視窗本身一樣收不到滑鼠移動，不讀的話 renderer 會以為
 * 游標一直停在剛移上來的地方，數值要等吉祥物自己走開才會消失。
 * 右鍵選單開著時不讀：游標離開吉祥物會讓視窗恢復穿透，點選單外面就穿過去了，選單收不到、關不掉。
 */
function startCursorPoll() {
  let last = ''
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible() || menuOpen) {
      last = ''
      return
    }
    const p = screen.getCursorScreenPoint()
    const b = win.getContentBounds()
    const x = p.x - b.x
    const y = p.y - b.y
    if (x < 0 || y < 0 || x >= b.width || y >= b.height) {
      if (last !== 'out') win.webContents.send('cursor', null)
      last = 'out'
      return
    }
    const key = `${x},${y}`
    if (key === last) return // 游標沒動就跟鉤子一樣不送，避免一直喚醒 renderer
    last = key
    win.webContents.send('cursor', { x, y })
  }, CURSOR_POLL_MS)
}

function applyCrabVisibility() {
  if (!win || win.isDestroyed()) return
  if (config.showCrab) {
    positionWindow()
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
  } else {
    // 常見情境是在螃蟹身上按右鍵把自己關掉，這時滑鼠正好壓在牠身上、視窗處於
    // 接管狀態。不先恢復穿透的話，下次顯示時整片視窗會擋住工具列。
    setInteractive(false)
    expanded = false
    win.hide()
  }
  applyWindowWatcher()
}

/** 設定視窗切換「在右下角顯示小圖示」：照新的設定改 Windows 的紀錄（直接顯示 / 收進 ^）。 */
function applyTrayVisibility() {
  if (!tray) createTray()
  syncTrayPromotion(0, true)
}

const SALMON_HATCH_MS = 10 * 60 * 1000 // 魚卵多久孵化
let hatchTimer = null

/** 魚卵到時間就孵化（清掉 salmonEgg），吉祥物視窗會播孵化的動畫、設定視窗的鮭魚又可以選。 */
function scheduleSalmonHatch() {
  clearTimeout(hatchTimer)
  hatchTimer = null
  if (!config.salmonEgg) return
  hatchTimer = setTimeout(() => {
    hatchTimer = null
    if (config.salmonEgg && config.salmonEgg.hatchAt <= Date.now() + 50) update({ salmonEgg: null })
    else scheduleSalmonHatch() // 電腦睡眠之類的讓計時器提早或延後了，重新算
  }, Math.max(0, config.salmonEgg.hatchAt - Date.now()))
}

/**
 * 所有設定變更都從這裡進來（設定視窗、再開一次 exe）。
 * 系統匣圖示一直都在（「在右下角顯示小圖示」關掉只是收進 ^ 裡），所以吉祥物和小圖示可以都關掉；
 * 不合法的變更回傳 false，設定視窗會把畫面還原。
 */
function applySettings(patch) {
  const clean = {}
  for (const [key, value] of Object.entries(patch || {})) {
    if (SETTING_RULES[key] && SETTING_RULES[key](value)) clean[key] = value
  }
  if (!Object.keys(clean).length) return false

  // 彩蛋：正在用鮭魚的時候換成黑熊 → 黑熊把鮭魚吃掉，鮭魚留下一顆魚卵，孵化前不能再選鮭魚
  if (clean.mascot === 'bear' && config.mascot === 'salmon') {
    clean.salmonEgg = { hatchAt: Date.now() + SALMON_HATCH_MS, x: null }
  }
  update(clean)
  if ('salmonEgg' in clean) scheduleSalmonHatch()
  if ('showCrab' in clean) applyCrabVisibility()
  if ('showTray' in clean) applyTrayVisibility()
  if (('displayId' in clean || 'mascot' in clean || 'roamScreen' in clean) && config.showCrab) {
    expanded = false
    positionWindow()
  }
  if ('mascot' in clean || 'roamScreen' in clean || 'perchWindows' in clean) applyWindowWatcher()
  if ('startOnLogin' in clean) applyLoginItem()
  return true
}

// ---------------------------------------------------------------- 選單與設定視窗

/** 設定都搬到設定視窗了，選單只留入口。 */
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: APP_NAME, enabled: false },
    { type: 'separator' },
    { label: '設定…', click: openSettings },
    { type: 'separator' },
    { label: '離開', click: () => { app.quit() } },
  ])
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore()
    settingsWin.show()
    settingsWin.focus()
    return
  }
  const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  settingsWin = new BrowserWindow({
    width: 460,
    height: Math.min(820, work.height - 40),
    useContentSize: true,
    resizable: true,
    minWidth: 380,
    minHeight: 420,
    maximizable: false,
    fullscreenable: false,
    title: `${APP_NAME} 設定`,
    icon: mascotIcon(),
    autoHideMenuBar: true,
    backgroundColor: '#1b1e24',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  settingsWin.setMenu(null)
  settingsWin.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[settings] ${source}:${line} ${message}`)
  })
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'))
  // ready-to-show 有時候很晚才來、甚至不來（視窗就一直藏著），所以頁面載入完也顯示一次當保險
  const reveal = () => {
    if (settingsWin && !settingsWin.isDestroyed() && !settingsWin.isVisible()) settingsWin.show()
  }
  settingsWin.once('ready-to-show', reveal)
  settingsWin.webContents.once('did-finish-load', () => setTimeout(reveal, 300))
  settingsWin.on('closed', () => { settingsWin = null })
}

function settingsState() {
  const primaryId = screen.getPrimaryDisplay().id
  return {
    config,
    version: app.getVersion(),
    dev: !app.isPackaged, // 用 npm start 跑的時候才顯示彩蛋的測試按鈕
    displays: screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `螢幕 ${i + 1}${d.id === primaryId ? '（主要）' : ''} — ${d.bounds.width}×${d.bounds.height}`,
      primary: d.id === primaryId,
    })),
    metrics: lastMetrics,
    // 繪圖方式：active 是這次啟動實際在用的；設定改了但還沒重新啟動的話 pending 是 true
    render: { ...startupRender, next: decideRender(config.renderMode).active },
  }
}

function sendToSettings(channel, data) {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send(channel, data)
}

// 打包後 README 在 asar 裡、而且別台電腦不一定有能開 .md 的程式，所以直接用對話框說明。
async function showTemperatureHelp() {
  const options = {
    type: 'info',
    title: APP_NAME,
    message: '為什麼溫度顯示 N/A？',
    detail:
      'Windows 本身沒有提供通用的 CPU / GPU 溫度介面。筆電通常讀得到，' +
      '桌上型電腦多半需要核心驅動才能讀主機板上的感測器。\n\n' +
      '想看到溫度的話：\n' +
      '1. 下載並執行 LibreHardwareMonitor（免費開源）\n' +
      '2. 在 Options 勾選「WMI Provider」\n' +
      '3. 讓它留在背景執行\n\n' +
      '會自動偵測到，約 2 秒後就會出現溫度，不需要重開。\n' +
      '使用率不受影響，沒裝也一樣正常運作。',
    buttons: ['開啟 LibreHardwareMonitor 下載頁', '關閉'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : null
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  if (response === 0) shell.openExternal('https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases')
}

function update(patch) {
  config = { ...config, ...patch }
  saveConfig()
  if (win && !win.isDestroyed()) win.webContents.send('config', config)
  sendToSettings('settings:state', settingsState())
  if ('mascot' in patch) applyTrayMascot()
}

function pickLoad(state) {
  const cpu = state.cpu.load || 0
  const gpu = state.gpu.load
  if (config.source === 'gpu') return gpu === null ? cpu : gpu
  if (config.source === 'max') return gpu === null ? cpu : Math.max(cpu, gpu)
  return cpu
}

// ---------------------------------------------------------------- 啟動

// 只允許跑一份，否則會有好幾隻螃蟹疊在一起
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // 再開一次 exe 就是「把吉祥物找回來」：兩個入口都強制打開，順便打開設定視窗
  app.on('second-instance', () => {
    applySettings({ showCrab: true, showTray: true })
    openSettings()
  })

  app.whenReady().then(() => {
    loadConfig()
    scheduleSalmonHatch()
    applyLoginItem()
    createWindow()
    createTray() // 一直都在：「在右下角顯示小圖示」關掉時是收進 ^ 裡面

    metrics = new Metrics({ probeScript: probeScriptPath() })
    metrics.on('update', (state) => {
      currentLoad = pickLoad(state)
      lastMetrics = { cpu: { ...state.cpu }, gpu: { ...state.gpu }, load: currentLoad }
      refreshTrayIcon(currentLoad)
      if (win && !win.isDestroyed()) win.webContents.send('metrics', { ...state, load: currentLoad })
      sendToSettings('settings:metrics', lastMetrics)
      if (tray) {
        tray.setToolTip(
          `CPU ${fmt(state.cpu.load, '%')}  ${fmt(state.cpu.temp, '°C')}\n` +
          `GPU ${fmt(state.gpu.load, '%')}  ${fmt(state.gpu.temp, '°C')}`
        )
      }
    })
    metrics.start()

    const onDisplaysChanged = () => {
      if (config.showCrab) positionWindow()
      sendToSettings('settings:state', settingsState())
    }
    screen.on('display-metrics-changed', onDisplaysChanged)
    screen.on('display-added', onDisplaysChanged)
    screen.on('display-removed', onDisplaysChanged)

    // 有些全螢幕程式會把自己推到更上層，定期把吉祥物頂回最前面
    setInterval(() => {
      if (win && !win.isDestroyed() && win.isVisible() && !interactive) win.setAlwaysOnTop(true, 'screen-saver')
    }, 10000)
    startCursorPoll()
  })

  // 註冊這個監聽器（即使什麼都不做）就會取消 Electron 的自動結束，讓程式常駐在背景
  app.on('window-all-closed', () => {})
  app.on('before-quit', () => {
    if (metrics) metrics.stop()
    windowWatcher.stop()
  })

  ipcMain.on('set-interactive', (_e, value) => setInteractive(!!value))
  // 吉祥物身上的右鍵選單直接掛在吉祥物視窗上，不依賴 tray
  ipcMain.on('show-menu', () => {
    if (!win || win.isDestroyed()) return
    menuOpen = true
    // 視窗平常不能取得焦點（不搶目前視窗的焦點），但選單所屬的程式要在前景，點選單外面才會關掉，
    // 所以開選單時暫時讓它可以取得焦點，關掉後再改回來。
    // Windows 上 setFocusable(true) 會順便讓視窗出現在工具列，要馬上再藏起來
    win.setFocusable(true)
    win.setSkipTaskbar(true)
    win.focus()
    buildMenu().popup({
      window: win,
      callback: () => {
        menuOpen = false
        if (win && !win.isDestroyed()) win.setFocusable(false)
      },
    })
  })
  ipcMain.on('open-settings', openSettings)
  ipcMain.handle('get-config', () => config)
  ipcMain.handle('get-layout', () => layout)
  ipcMain.on('set-expanded', (_e, value) => {
    if (!!value === expanded) return
    expanded = !!value
    positionWindow()
  })
  // 吉祥物放開並落地後：記住牠在哪台螢幕，視窗縮回那台
  ipcMain.on('drop-on-display', (_e, id) => {
    const found = screen.getAllDisplays().find((d) => d.id === id)
    expanded = false
    if (found) update({ displayId: found.id })
    positionWindow()
  })

  // 設定視窗
  ipcMain.handle('settings:get', () => settingsState())
  ipcMain.handle('settings:update', (_e, patch) => ({ ok: applySettings(patch), state: settingsState() }))
  ipcMain.on('settings:temp-help', () => { showTemperatureHelp() })
  ipcMain.on('settings:quit', () => { app.quit() })
  // 換了繪圖方式要重新啟動才會生效。portable exe 要重開使用者點的那個 exe，
  // 不能重開暫存資料夾裡那份（結束時會被清掉）。
  ipcMain.on('settings:relaunch', () => {
    const portable = process.env.PORTABLE_EXECUTABLE_FILE
    app.relaunch(portable ? { execPath: portable, args: [] } : undefined)
    app.quit()
  })
  // 吉祥物視窗告訴我們魚卵生在哪裡（螢幕座標），重新開程式時才放得回原位
  ipcMain.on('salmon-egg-x', (_e, x) => {
    if (config.salmonEgg && Number.isFinite(x)) update({ salmonEgg: { ...config.salmonEgg, x } })
  })
  // 彩蛋的測試按鈕（開發時才有）
  ipcMain.on('settings:test-egg', (_e, name) => {
    if (app.isPackaged || !['dizzy', 'shake', 'rest', 'feast', 'hatch'].includes(name)) return
    if (name === 'feast') {
      // 黑熊吃鮭魚：先換成鮭魚（還有魚卵的話先讓它孵化），過一下再換成黑熊
      if (config.salmonEgg) {
        update({ salmonEgg: null })
        scheduleSalmonHatch()
      }
      applySettings({ mascot: 'salmon' })
      setTimeout(() => applySettings({ mascot: 'bear' }), 2500)
      return
    }
    if (name === 'hatch') {
      // 魚卵 2 秒後孵化
      if (config.salmonEgg) {
        update({ salmonEgg: { ...config.salmonEgg, hatchAt: Date.now() + 2000 } })
        scheduleSalmonHatch()
      }
      return
    }
    if (win && !win.isDestroyed()) win.webContents.send('egg', name)
  })
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`逾時 ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function fmt(v, unit) {
  return v === null || v === undefined ? 'N/A' : `${Math.round(v)}${unit}`
}
