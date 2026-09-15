'use strict'

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, dialog, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const { Metrics } = require('./metrics')
const { createCrabIcon } = require('./tray-icon')

const BAR_HEIGHT = 130 // 視窗高度：螃蟹 + 上方的數值氣泡

const DEFAULTS = {
  source: 'cpu',      // 'cpu' | 'gpu' | 'max'
  showLabel: true,
  scale: 1,
  displayId: null,    // null = 主螢幕
  startOnLogin: false,
  showCrab: true,     // 在桌面（工具列上）顯示螃蟹
  showTray: true,     // 在右下角系統匣顯示小圖示
}

// 系統匣圖示每 5% 一種顏色；Windows 在 100% / 150% / 200% 縮放下分別要 16 / 24 / 32px
const TRAY_BUCKETS = Array.from({ length: 21 }, (_, i) => i * 5)
const TRAY_SCALES = [[1, 16], [1.5, 24], [2, 32]]

let win = null
let tray = null
let metrics = null
let config = { ...DEFAULTS }
let lastIconLoad = -1
let currentLoad = 0
let interactive = false
const trayIcons = new Map()

const configPath = () => path.join(app.getPath('userData'), 'settings.json')

function loadConfig() {
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
  // 用 bounds 而不是 workArea：我們要蓋在工具列上面，不是停在工具列上方。
  win.setBounds({
    x: d.bounds.x,
    y: d.bounds.y + d.bounds.height - BAR_HEIGHT,
    width: d.bounds.width,
    height: BAR_HEIGHT,
  })
  win.webContents.send('layout', { width: d.bounds.width, height: BAR_HEIGHT })
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
      .then(() => { lastIconLoad = -1; refreshTrayIcon(currentLoad) })
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
    const out = {}
    for (const b of ${JSON.stringify(TRAY_BUCKETS)}) {
      const hue = window.CrabArt.loadToHue(b)
      out[b] = ${JSON.stringify(sizes)}.map((px) => window.CrabArt.renderIcon(px, hue))
    }
    return out
  })()`
  const urls = await withTimeout(win.webContents.executeJavaScript(script), 5000)
  for (const b of TRAY_BUCKETS) {
    const img = nativeImage.createEmpty()
    TRAY_SCALES.forEach(([scaleFactor], i) => img.addRepresentation({ scaleFactor, dataURL: urls[b][i] }))
    trayIcons.set(b, img)
  }
}

function bucketOf(load) {
  return Math.round(Math.max(0, Math.min(100, load || 0)) / 5) * 5
}

function trayImage(bucket) {
  return trayIcons.get(bucket) || createCrabIcon(bucket)
}

function refreshTrayIcon(load) {
  if (!tray) return
  const bucket = bucketOf(load)
  if (bucket === lastIconLoad) return
  lastIconLoad = bucket
  tray.setImage(trayImage(bucket))
}

function createTray() {
  lastIconLoad = -1
  tray = new Tray(trayImage(bucketOf(currentLoad)))
  tray.setToolTip('螃蟹監視器')
  tray.setContextMenu(buildMenu())
  tray.on('click', () => tray.popUpContextMenu())
  refreshTrayIcon(currentLoad)
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
    win.hide()
  }
}

function applyTrayVisibility() {
  if (config.showTray && !tray) {
    createTray()
  } else if (!config.showTray && tray) {
    tray.destroy()
    tray = null
  }
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
    { label: '🦀 螃蟹監視器', enabled: false },
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
      label: '螃蟹大小',
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
      label: crabLocked ? '在桌面顯示螃蟹（至少要留一個）' : '在桌面顯示螃蟹',
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
    title: '螃蟹監視器',
    message: '為什麼溫度顯示 N/A？',
    detail:
      'Windows 本身沒有提供通用的 CPU / GPU 溫度介面。筆電通常讀得到，' +
      '桌上型電腦多半需要核心驅動才能讀主機板上的感測器。\n\n' +
      '想看到溫度的話：\n' +
      '1. 下載並執行 LibreHardwareMonitor（免費開源）\n' +
      '2. 在 Options 勾選「WMI Provider」\n' +
      '3. 讓它留在背景執行\n\n' +
      '螃蟹會自動偵測到，約 2 秒後就會出現溫度，不需要重開。\n' +
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
