'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('crabAPI', {
  onMetrics: (cb) => ipcRenderer.on('metrics', (_e, data) => cb(data)),
  onConfig: (cb) => ipcRenderer.on('config', (_e, data) => cb(data)),
  onLayout: (cb) => ipcRenderer.on('layout', (_e, data) => cb(data)),
  onPerches: (cb) => ipcRenderer.on('perches', (_e, data) => cb(data)),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, data) => cb(data)),
  onMouseReset: (cb) => ipcRenderer.on('mouse-reset', () => cb()),
  refreshMouse: () => ipcRenderer.send('refresh-mouse'),
  onEgg: (cb) => ipcRenderer.on('egg', (_e, name) => cb(name)),
  salmonEggAt: (screenX) => ipcRenderer.send('salmon-egg-x', screenX),
  setExpanded: (value) => ipcRenderer.send('set-expanded', value),
  dropOnDisplay: (id) => ipcRenderer.send('drop-on-display', id),
  getLayout: () => ipcRenderer.invoke('get-layout'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setInteractive: (value) => ipcRenderer.send('set-interactive', value),
  showMenu: () => ipcRenderer.send('show-menu'),
  openSettings: () => ipcRenderer.send('open-settings'),
})
