'use strict'

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, dialog, nativeImage } = require('electron')
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

const { Metrics } = require('./metrics')
const { createCrabIcon } = require('./tray-icon')

const APP_NAME = 'Monitor-CPU'
// 改名前用過的設定資料夾；新資料夾還沒有設定檔時，會從這裡複製一份過來
const LEGACY_DATA_DIRS = ['crab-monitor']

// 設定資料夾固定叫 Monitor-CPU，不隨 package.json 的 name 或打包工具的預設而變。
// 單一執行個體鎖也是跟著這個資料夾走，所以要在 requestSingleInstanceLock 之前設定。
app.setName(APP_NAME)
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME))

const BAR_HEIGHT = 360 // 視窗高度：螃蟹 + 上方的數值氣泡 + 被拖起來時可以抬高的空間

const DEFAULTS = {
  source: 'cpu',          // 'cpu' | 'gpu' | 'max'
  showLabel: true,
  scale: 1,
  displayId: null,        // null = 主螢幕
  startOnLogin: false,
  mascot: 'crab',         // 'crab' | 'bird'（搖頭小鳥）
  showCrab: true,         // 在桌面（工具列上）顯示吉祥物
  showTray: true,         // 在右下角系統匣顯示小圖示
  promotedTrayPaths: [],  // 已經自動設成「直接顯示在右下角」過的 exe 路徑
}

// 系統匣圖示每 5% 一種顏色；Windows 在 100% / 150% / 200% 縮放下分別要 16 / 24 / 32px
const TRAY_BUCKETS = Array.from({ length: 21 }, (_, i) => i * 5)
const TRAY_SCALES = [[1, 16], [1.5, 24], [2, 32]]
// 小鳥的系統匣圖示是搖頭動畫：一個搖頭週期畫成幾張，依負載換張的速度
const BIRD_FRAMES = 8
const BIRD_CYCLES_PER_SEC = [0.6, 2.5] // 0% 與 100% 負載時每秒搖幾個週期

// 圖示第一次出現後 Explorer 才會建立它的紀錄，所以分幾次、越等越久去找
const PROMOTE_RETRY_MS = [1500, 3000, 6000, 12000, 20000]

let win = null
let tray = null
let metrics = null
let config = { ...DEFAULTS }
let lastIconLoad = -1
let currentLoad = 0
let interactive = false
let expanded = false // 拖曳中：視窗展開成涵蓋所有螢幕
let layout = null // 最後一次算出的視窗尺寸與工具列高度；renderer 太晚載入來不及收 layout 事件時主動來問
let promoteTimer = null
const trayIcons = new Map()
const birdIcons = []
let birdFrame = 0
let birdTimer = null

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
  } catch (_) {
    config = { ...DEFAULTS }
  }
  // 兩個都關掉就完全找不到選單了（設定檔被手動改壞時才會發生）
  if (!config.showCrab && !config.showTray) config.showTray = true
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
    bounds = { x: left, y: top, width: right - left, height: bottom - top }
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
  // 工具列在別邊或自動隱藏時工作區底部等於螢幕底部，螃蟹就直接站在螢幕底部。
  layout = {
    width: bounds.width,
    height: bounds.height,
    originX: bounds.x,
    originY: bounds.y,
    expanded,
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
    return { crab, bird }
  })()`
  const { crab, bird } = await withTimeout(win.webContents.executeJavaScript(script), 5000)
  const toImage = (urls) => {
    const img = nativeImage.createEmpty()
    TRAY_SCALES.forEach(([scaleFactor], i) => img.addRepresentation({ scaleFactor, dataURL: urls[i] }))
    return img
  }
  for (const b of TRAY_BUCKETS) trayIcons.set(b, toImage(crab[b]))
  birdIcons.length = 0
  bird.forEach((urls) => birdIcons.push(toImage(urls)))
}

function bucketOf(load) {
  return Math.round(Math.max(0, Math.min(100, load || 0)) / 5) * 5
}

function trayImage(bucket) {
  return trayIcons.get(bucket) || createCrabIcon(bucket)
}

function refreshTrayIcon(load) {
  if (!tray || config.mascot === 'bird') return // 小鳥用計時器換張，不跟著顏色
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
  tray.on('click', () => tray.popUpContextMenu())
  applyTrayMascot()

  clearTimeout(promoteTimer)
  promoteTimer = setTimeout(() => promoteTrayIcon(0), PROMOTE_RETRY_MS[0])
}

function destroyTray() {
  clearTimeout(promoteTimer)
  clearTimeout(birdTimer)
  birdTimer = null
  if (tray) tray.destroy()
  tray = null
}

// ---------------------------------------------------------------- 右下角直接顯示

/**
 * Windows 11 預設把新程式的系統匣圖示收進 ^ 箭頭裡，要使用者自己到
 * 「設定 → 個人化 → 工作列 → 其他系統匣圖示」打開。那個開關其實就是
 * HKCU\Control Panel\NotifyIconSettings\<id> 底下的 IsPromoted，
 * 每筆紀錄用 ExecutablePath 對應到 exe。
 *
 * 每個 exe 位置只自動打開一次：之後使用者若在 Windows 設定裡把它收回去，
 * 就尊重他的選擇。Windows 10 用的是另一種二進位格式，找不到紀錄就放棄。
 *
 * exe 路徑用環境變數傳進去，使用者名稱是中文的電腦也不會有編碼問題。
 */
const PROMOTE_TRAY_PS = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$exe = $env:MONITOR_CPU_EXE',
  "$result = 'notfound'",
  "foreach ($key in Get-ChildItem 'HKCU:\\Control Panel\\NotifyIconSettings') {",
  '  $p = Get-ItemProperty $key.PSPath',
  '  if ($p.ExecutablePath -and $p.ExecutablePath -eq $exe) {',
  "    if ($p.IsPromoted -eq 1) { if ($result -eq 'notfound') { $result = 'already' } }",
  "    else { Set-ItemProperty $key.PSPath -Name IsPromoted -Value 1 -Type DWord; $result = 'promoted' }",
  '  }',
  '}',
  '$result',
].join('\n')

function promoteTrayIcon(attempt) {
  if (process.platform !== 'win32' || !tray) return
  const exe = process.execPath
  if ((config.promotedTrayPaths || []).some((p) => p.toLowerCase() === exe.toLowerCase())) return

  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PROMOTE_TRAY_PS, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15000, env: { ...process.env, MONITOR_CPU_EXE: exe } },
    (_err, stdout) => {
      const result = String(stdout || '').trim()
      if (result === 'promoted' || result === 'already') {
        update({ promotedTrayPaths: [...(config.promotedTrayPaths || []), exe] })
        // 剛改好的話重新掛一次圖示，Explorer 重新登記時就會照新設定直接顯示
        if (result === 'promoted' && tray) {
          destroyTray()
          createTray()
        }
      } else if (attempt + 1 < PROMOTE_RETRY_MS.length) {
        promoteTimer = setTimeout(() => promoteTrayIcon(attempt + 1), PROMOTE_RETRY_MS[attempt + 1])
      }
    }
  )
}

// ---------------------------------------------------------------- 顯示開關

function setInteractive(next) {
  if (!win || win.isDestroyed() || next === interactive) return
  interactive = next
  win.setIgnoreMouseEvents(!next, { forward: true })
}

function applyCrabVisibility() {
  if (!win || win.isDestroyed()) return
  if (config.showCrab) {
    positionWindow()
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
  } else {
    // 常見情境是在螃蟹身上按右鍵把自己關掉，這時滑鼠正好壓在牠身上、視窗處於
    // 接管狀態。不先恢復穿透的話，下次顯示時整條 130px 會擋住工具列。
    setInteractive(false)
    expanded = false
    win.hide()
  }
}

function applyTrayVisibility() {
  if (config.showTray && !tray) createTray()
  else if (!config.showTray && tray) destroyTray()
}

/** 螃蟹與系統匣圖示是唯二能叫出選單的地方，所以不允許兩個同時關掉。 */
function setVisibility(patch) {
  const next = { ...config, ...patch }
  if (!next.showCrab && !next.showTray) {
    if (tray) tray.setContextMenu(buildMenu()) // 把被點掉的勾勾還原
    return
  }
  update(patch)
  applyCrabVisibility()
  applyTrayVisibility()
}

// ---------------------------------------------------------------- 選單

function buildMenu() {
  const displays = screen.getAllDisplays()
  const primaryId = screen.getPrimaryDisplay().id
  const crabLocked = config.showCrab && !config.showTray
  const trayLocked = config.showTray && !config.showCrab

  return Menu.buildFromTemplate([
    { label: APP_NAME, enabled: false },
    { type: 'separator' },
    {
      label: '監看來源',
      submenu: [
        mkRadio('CPU 使用率', 'source', 'cpu'),
        mkRadio('GPU 使用率', 'source', 'gpu'),
        mkRadio('兩者取較高', 'source', 'max'),
      ],
    },
    {
      label: '吉祥物',
      submenu: [
        mkRadio('螃蟹', 'mascot', 'crab'),
        mkRadio('搖頭小鳥', 'mascot', 'bird'),
      ],
    },
    {
      label: '大小',
      submenu: [
        mkRadio('小', 'scale', 0.75),
        mkRadio('中', 'scale', 1),
        mkRadio('大', 'scale', 1.35),
      ],
    },
    {
      label: '顯示數值標籤',
      type: 'checkbox',
      checked: config.showLabel,
      click: (item) => update({ showLabel: item.checked }),
    },
    {
      label: '顯示在螢幕',
      submenu: displays.map((d, i) => ({
        label: `螢幕 ${i + 1}${d.id === primaryId ? '（主要）' : ''} — ${d.bounds.width}×${d.bounds.height}`,
        type: 'radio',
        checked: (config.displayId === null ? primaryId : config.displayId) === d.id,
        click: () => { update({ displayId: d.id }); positionWindow() },
      })),
    },
    { type: 'separator' },
    {
      label: crabLocked ? '在桌面顯示吉祥物（至少要留一個）' : '在桌面顯示吉祥物',
      type: 'checkbox',
      checked: config.showCrab,
      enabled: !crabLocked,
      click: (item) => setVisibility({ showCrab: item.checked }),
    },
    {
      label: trayLocked ? '在右下角顯示小圖示（至少要留一個）' : '在右下角顯示小圖示',
      type: 'checkbox',
      checked: config.showTray,
      enabled: !trayLocked,
      click: (item) => setVisibility({ showTray: item.checked }),
    },
    { type: 'separator' },
    {
      label: '開機時自動啟動',
      type: 'checkbox',
      checked: config.startOnLogin,
      click: (item) => {
        update({ startOnLogin: item.checked })
        try {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: [] })
        } catch (_) { /* 某些環境不支援 */ }
      },
    },
    { label: '溫度顯示 N/A？', click: showTemperatureHelp },
    { type: 'separator' },
    { label: '離開', click: () => { app.quit() } },
  ])
}

// 打包後 README 在 asar 裡、而且別台電腦不一定有能開 .md 的程式，所以直接用對話框說明。
async function showTemperatureHelp() {
  const { response } = await dialog.showMessageBox({
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
  })
  if (response === 0) shell.openExternal('https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases')
}

function mkRadio(label, key, value) {
  return {
    label,
    type: 'radio',
    checked: config[key] === value,
    click: () => update({ [key]: value }),
  }
}

function update(patch) {
  config = { ...config, ...patch }
  saveConfig()
  if (win && !win.isDestroyed()) win.webContents.send('config', config)
  if (tray) tray.setContextMenu(buildMenu())
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
  // 再開一次 exe 就是「把螃蟹找回來」：兩個入口都強制打開
  app.on('second-instance', () => setVisibility({ showCrab: true, showTray: true }))

  app.whenReady().then(() => {
    loadConfig()
    createWindow()
    if (config.showTray) createTray()

    metrics = new Metrics({ probeScript: probeScriptPath() })
    metrics.on('update', (state) => {
      currentLoad = pickLoad(state)
      refreshTrayIcon(currentLoad)
      if (win && !win.isDestroyed()) win.webContents.send('metrics', { ...state, load: currentLoad })
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
      if (tray) tray.setContextMenu(buildMenu())
    }
    screen.on('display-metrics-changed', onDisplaysChanged)
    screen.on('display-added', onDisplaysChanged)
    screen.on('display-removed', onDisplaysChanged)

    // 有些全螢幕程式會把自己推到更上層，定期把螃蟹頂回最前面
    setInterval(() => {
      if (win && !win.isDestroyed() && win.isVisible() && !interactive) win.setAlwaysOnTop(true, 'screen-saver')
    }, 10000)
  })

  // 註冊這個監聽器（即使什麼都不做）就會取消 Electron 的自動結束，讓程式常駐在背景
  app.on('window-all-closed', () => {})
  app.on('before-quit', () => { if (metrics) metrics.stop() })

  ipcMain.on('set-interactive', (_e, value) => setInteractive(!!value))
  // 系統匣圖示可能被關掉了，所以右鍵選單直接掛在螃蟹視窗上，不依賴 tray
  ipcMain.on('show-menu', () => {
    if (win && !win.isDestroyed()) buildMenu().popup({ window: win })
  })
  ipcMain.handle('get-config', () => config)
  ipcMain.handle('get-layout', () => layout)
  ipcMain.on('set-expanded', (_e, value) => {
    if (!!value === expanded) return
    expanded = !!value
    positionWindow()
  })
  // 螃蟹放開並落地後：記住牠在哪台螢幕，視窗縮回那台的底部
  ipcMain.on('drop-on-display', (_e, id) => {
    const found = screen.getAllDisplays().find((d) => d.id === id)
    expanded = false
    if (found) update({ displayId: found.id })
    positionWindow()
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
