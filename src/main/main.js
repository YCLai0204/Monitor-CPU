'use strict'

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell } = require('electron')
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
}

let win = null
let tray = null
let metrics = null
let config = { ...DEFAULTS }
let lastIconLoad = -1
let interactive = false

const configPath = () => path.join(app.getPath('userData'), 'settings.json')

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    config = { ...DEFAULTS, ...raw }
  } catch (_) {
    config = { ...DEFAULTS }
  }
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
    positionWindow()
    win.showInactive()
    win.webContents.send('config', config)
  })
}

function setInteractive(next) {
  if (!win || win.isDestroyed() || next === interactive) return
  interactive = next
  win.setIgnoreMouseEvents(!next, { forward: true })
}

function buildMenu() {
  const displays = screen.getAllDisplays()
  const primaryId = screen.getPrimaryDisplay().id

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
    {
      label: '溫度顯示 N/A？看說明',
      click: () => {
        const readme = path.join(app.getAppPath(), 'README.md')
        if (fs.existsSync(readme)) shell.openPath(readme)
      },
    },
    { type: 'separator' },
    { label: '離開', click: () => { app.quit() } },
  ])
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

function refreshTrayIcon(load) {
  if (!tray) return
  const bucket = Math.round(load / 5) * 5
  if (bucket === lastIconLoad) return
  lastIconLoad = bucket
  tray.setImage(createCrabIcon(bucket))
}

function pickLoad(state) {
  const cpu = state.cpu.load || 0
  const gpu = state.gpu.load
  if (config.source === 'gpu') return gpu === null ? cpu : gpu
  if (config.source === 'max') return gpu === null ? cpu : Math.max(cpu, gpu)
  return cpu
}

function createTray() {
  tray = new Tray(createCrabIcon(0))
  tray.setToolTip('螃蟹監視器')
  tray.setContextMenu(buildMenu())
  tray.on('click', () => tray.popUpContextMenu())
}

// 只允許跑一份，否則會有好幾隻螃蟹疊在一起
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { if (win) win.showInactive() })

  app.whenReady().then(() => {
    loadConfig()
    createWindow()
    createTray()

    metrics = new Metrics({ probeScript: probeScriptPath() })
    metrics.on('update', (state) => {
      const load = pickLoad(state)
      refreshTrayIcon(load)
      if (win && !win.isDestroyed()) win.webContents.send('metrics', { ...state, load })
      if (tray) {
        tray.setToolTip(
          `CPU ${fmt(state.cpu.load, '%')}  ${fmt(state.cpu.temp, '°C')}\n` +
          `GPU ${fmt(state.gpu.load, '%')}  ${fmt(state.gpu.temp, '°C')}`
        )
      }
    })
    metrics.start()

    screen.on('display-metrics-changed', positionWindow)
    screen.on('display-added', () => { positionWindow(); if (tray) tray.setContextMenu(buildMenu()) })
    screen.on('display-removed', () => { positionWindow(); if (tray) tray.setContextMenu(buildMenu()) })

    // 有些全螢幕程式會把自己推到更上層，定期把螃蟹頂回最前面
    setInterval(() => {
      if (win && !win.isDestroyed() && !interactive) win.setAlwaysOnTop(true, 'screen-saver')
    }, 10000)
  })

  // 註冊這個監聽器（即使什麼都不做）就會取消 Electron 的自動結束，讓程式常駐在系統匣
  app.on('window-all-closed', () => {})
  app.on('before-quit', () => { if (metrics) metrics.stop() })

  ipcMain.on('set-interactive', (_e, value) => setInteractive(!!value))
  ipcMain.on('show-menu', () => { if (tray) tray.popUpContextMenu(buildMenu()) })
  ipcMain.handle('get-config', () => config)
}

function fmt(v, unit) {
  return v === null || v === undefined ? 'N/A' : `${Math.round(v)}${unit}`
}
