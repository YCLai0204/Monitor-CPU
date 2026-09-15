'use strict'

const os = require('os')
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')
const { spawn } = require('child_process')

const CPU_INTERVAL_MS = 500 // CPU 用純 JS 算，取樣密一點才跟得上尖峰

/**
 * 蒐集 CPU / GPU 的使用率與溫度。
 *
 * CPU 使用率完全靠 Node 內建的 os.cpus()，所以任何平台、任何權限都拿得到。
 * 溫度與 GPU 則交給 probe.ps1（Windows）或 /sys/class/thermal（Linux），
 * 抓不到就是 null，呼叫端負責顯示 N/A。
 */
class Metrics extends EventEmitter {
  constructor(options = {}) {
    super()
    this.probeScript = options.probeScript
    this.state = {
      cpu: { load: 0, temp: null, name: null },
      gpu: { load: null, temp: null, name: null },
      gpuSource: 'none',
    }
    this._prev = null
    this._cpuTimer = null
    this._probe = null
    this._stopped = false
    this._smoothed = 0
  }

  start() {
    this._stopped = false
    this._prev = readCpuTimes()
    this._cpuTimer = setInterval(() => this._sampleCpu(), CPU_INTERVAL_MS)
    if (process.platform === 'win32') this._startProbe()
    else this._startPosixProbe()
  }

  stop() {
    this._stopped = true
    if (this._cpuTimer) clearInterval(this._cpuTimer)
    this._cpuTimer = null
    if (this._posixTimer) clearInterval(this._posixTimer)
    this._posixTimer = null
    if (this._probe) {
      this._probe.removeAllListeners()
      try { this._probe.kill() } catch (_) { /* 已經結束了 */ }
      this._probe = null
    }
  }

  _sampleCpu() {
    const now = readCpuTimes()
    const idleDelta = now.idle - this._prev.idle
    const totalDelta = now.total - this._prev.total
    this._prev = now
    if (totalDelta <= 0) return

    const load = clamp(100 * (1 - idleDelta / totalDelta), 0, 100)
    // 輕度平滑，否則螃蟹會因為瞬間尖峰抽搐
    this._smoothed = this._smoothed * 0.6 + load * 0.4
    this.state.cpu.load = Math.round(this._smoothed * 10) / 10
    if (!this.state.cpu.name) this.state.cpu.name = (os.cpus()[0] || {}).model || null
    this.emit('update', this.state)
  }

  _startProbe() {
    if (this._stopped) return
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', this.probeScript,
      '-IntervalMs', '2000',
    ]
    let child
    try {
      child = spawn('powershell.exe', args, { windowsHide: true })
    } catch (err) {
      this.emit('probe-error', err)
      return
    }
    this._probe = child

    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (line) this._consumeProbeLine(line)
      }
      if (buffer.length > 64 * 1024) buffer = '' // 壞掉的輸出不要無限長大
    })
    child.stderr.on('data', () => { /* probe 內部自己吞錯，這裡忽略雜訊 */ })
    child.on('exit', () => {
      this._probe = null
      if (!this._stopped) setTimeout(() => this._startProbe(), 5000) // 掛了就重開
    })
  }

  _consumeProbeLine(line) {
    let data
    try {
      data = JSON.parse(line)
    } catch (_) {
      return
    }
    this.state.cpu.temp = numOrNull(data.cpuTemp)
    if (data.cpuName) this.state.cpu.name = data.cpuName
    this.state.gpu.load = numOrNull(data.gpuLoad)
    this.state.gpu.temp = numOrNull(data.gpuTemp)
    if (data.gpuName) this.state.gpu.name = data.gpuName
    this.state.gpuSource = data.source || 'none'
    this.emit('update', this.state)
  }

  _startPosixProbe() {
    // macOS 沒有免權限的溫度來源，Linux 則讀 thermal zone。兩邊都只是盡力而為。
    const read = () => {
      if (process.platform !== 'linux') return
      try {
        const base = '/sys/class/thermal'
        const zones = fs.readdirSync(base).filter((d) => d.startsWith('thermal_zone'))
        let best = null
        for (const z of zones) {
          const raw = parseInt(fs.readFileSync(path.join(base, z, 'temp'), 'utf8'), 10)
          if (!Number.isFinite(raw)) continue
          const c = raw > 1000 ? raw / 1000 : raw
          if (c > 0 && c < 150 && (best === null || c > best)) best = c
        }
        this.state.cpu.temp = best === null ? null : Math.round(best * 10) / 10
      } catch (_) {
        this.state.cpu.temp = null
      }
    }
    read()
    this._posixTimer = setInterval(read, 2000)
  }
}

function readCpuTimes() {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    for (const key of Object.keys(cpu.times)) total += cpu.times[key]
    idle += cpu.times.idle
  }
  return { idle, total }
}

function numOrNull(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : null
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

module.exports = { Metrics }
