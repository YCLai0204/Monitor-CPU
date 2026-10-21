'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('settings:get'),
  update: (patch) => ipcRenderer.invoke('settings:update', patch),
  onState: (cb) => ipcRenderer.on('settings:state', (_e, data) => cb(data)),
  onMetrics: (cb) => ipcRenderer.on('settings:metrics', (_e, data) => cb(data)),
  temperatureHelp: () => ipcRenderer.send('settings:temp-help'),
  quit: () => ipcRenderer.send('settings:quit'),
})
