'use strict'

const { drawCrab, drawBubbles, loadToHue } = window.CrabArt

const canvas = document.getElementById('stage')
const ctx = canvas.getContext('2d')
const label = document.getElementById('label')

const GROUND_OFFSET = 14   // 腳底距離螢幕最底部的距離（讓螃蟹站在工具列上）
const CRAB_HALF_W = 58     // scale=1 時大約的半寬（含張開的腳與螯），用來判斷邊界與滑鼠命中
const CRAB_TOP = 68        // scale=1 時從腳底往上的高度
const MIN_SPEED = 10       // px/s，0% 負載
const MAX_SPEED = 320      // px/s，100% 負載
const STRIDE = 26          // 走幾 px 算一個步伐週期

let config = { source: 'cpu', showLabel: true, scale: 1 }
let metrics = { cpu: { load: 0, temp: null }, gpu: { load: null, temp: null }, load: 0 }

let viewW = window.innerWidth
let viewH = window.innerHeight

const actor = {
  x: viewW / 2,
  dir: 1,
  speed: 0,
  phase: 0,
  pause: 0,
  blink: 0,
  nextBlink: 2 + Math.random() * 4,
}

const bubbles = []
let pinned = false
let hovering = false
let lastT = performance.now()

// ---------------------------------------------------------------- 尺寸

function resize(w, h) {
  viewW = w || window.innerWidth
  viewH = h || window.innerHeight
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(viewW * dpr)
  canvas.height = Math.round(viewH * dpr)
  canvas.style.width = `${viewW}px`
  canvas.style.height = `${viewH}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  actor.x = Math.min(actor.x, viewW - CRAB_HALF_W * config.scale)
}

window.addEventListener('resize', () => resize())

// ---------------------------------------------------------------- 主迴圈

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000) // 視窗被凍結後不要瞬移
  lastT = now

  step(dt)
  render(now)
  requestAnimationFrame(frame)
}

function step(dt) {
  const load = clamp(metrics.load || 0, 0, 100)
  const scale = config.scale
  const margin = CRAB_HALF_W * scale + 6

  // 目標速度：負載越高越快，用次方讓低負載那一段的變化也看得出來
  const targetSpeed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.pow(load / 100, 1.2)

  // 低負載時螃蟹會走走停停；高負載時完全沒空休息
  if (actor.pause > 0) {
    actor.pause -= dt
    actor.speed += (0 - actor.speed) * Math.min(1, dt * 6)
  } else {
    actor.speed += (targetSpeed - actor.speed) * Math.min(1, dt * 2.5)
    const idleChance = load < 25 ? 0.09 : load < 55 ? 0.02 : 0
    if (idleChance > 0 && Math.random() < idleChance * dt * 10) {
      actor.pause = 0.6 + Math.random() * 2.2
    }
    // 偶爾自己轉向，才不會像一顆來回彈的球
    if (Math.random() < 0.12 * dt) actor.dir *= -1
  }

  const dx = actor.speed * actor.dir * dt
  actor.x += dx

  if (actor.x < margin) {
    actor.x = margin
    actor.dir = 1
  } else if (actor.x > viewW - margin) {
    actor.x = viewW - margin
    actor.dir = -1
  }

  // 步伐週期綁在實際位移上：跑越快腳動越快，慢下來也不會滑步
  actor.phase += (Math.abs(dx) / (STRIDE * scale)) * Math.PI * 2 + dt * 1.1

  // 眨眼
  actor.nextBlink -= dt
  if (actor.nextBlink <= 0) {
    actor.blink = Math.min(1, actor.blink + dt * 12)
    if (actor.blink >= 1) actor.nextBlink = 2 + Math.random() * 5
  } else if (actor.blink > 0) {
    actor.blink = Math.max(0, actor.blink - dt * 10)
  }

  updateBubbles(dt, load)
  updateLabel()
}

function updateBubbles(dt, load) {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i]
    b.y -= b.vy * dt
    b.x += Math.sin(b.y * 0.08) * 0.3
    b.alpha -= dt * 0.35
    if (b.alpha <= 0) bubbles.splice(i, 1)
  }
  if (load < 30 && bubbles.length < 6 && Math.random() < dt * 1.6) {
    bubbles.push({
      x: (Math.random() - 0.5) * 10,
      y: -30,
      r: 1.6 + Math.random() * 2.6,
      vy: 10 + Math.random() * 14,
      alpha: 0.9,
    })
  }
}

function render(now) {
  ctx.clearRect(0, 0, viewW, viewH)

  const load = clamp(metrics.load || 0, 0, 100)
  const scale = config.scale
  const groundY = viewH - GROUND_OFFSET

  ctx.save()
  ctx.translate(actor.x, groundY)

  if (bubbles.length) drawBubbles(ctx, bubbles, scale)

  drawCrab(ctx, {
    scale,
    hue: loadToHue(load),
    phase: actor.phase,
    speed: actor.speed,
    dir: actor.dir,
    heat: clamp((load - 55) / 45, 0, 1),
    blink: actor.blink,
    time: now,
  })
  ctx.restore()
}

// ---------------------------------------------------------------- 數值標籤

function updateLabel() {
  const show = config.showLabel || pinned || hovering
  if (!show) {
    label.classList.remove('visible')
    return
  }

  const cpu = metrics.cpu || {}
  const gpu = metrics.gpu || {}
  const parts = [`CPU ${fmt(cpu.load, '%')}${has(cpu.temp) ? ` ${fmt(cpu.temp, '°')}` : ''}`]
  if (has(gpu.load)) {
    parts.push(`GPU ${fmt(gpu.load, '%')}${has(gpu.temp) ? ` ${fmt(gpu.temp, '°')}` : ''}`)
  } else if (has(gpu.temp)) {
    parts.push(`GPU ${fmt(gpu.temp, '°')}`)
  }

  label.textContent = parts.join('　')
  label.dataset.source = config.source
  label.style.setProperty('--hue', String(Math.round(loadToHue(clamp(metrics.load || 0, 0, 100)))))

  const w = label.offsetWidth || 120
  const lx = Math.max(6, Math.min(viewW - w - 6, actor.x - w / 2))
  const ly = viewH - GROUND_OFFSET - CRAB_TOP * config.scale - 26
  label.style.transform = `translate(${Math.round(lx)}px, ${Math.round(ly)}px)`
  label.classList.add('visible')
}

function has(v) {
  return v !== null && v !== undefined && !Number.isNaN(v)
}

function fmt(v, unit) {
  return has(v) ? `${Math.round(v)}${unit}` : 'N/A'
}

// ---------------------------------------------------------------- 滑鼠

// 視窗預設整片穿透（工具列才點得到），只有游標壓在螃蟹身上時才短暫接管。
function overCrab(px, py) {
  const scale = config.scale
  const groundY = viewH - GROUND_OFFSET
  const halfW = CRAB_HALF_W * scale
  const top = groundY - CRAB_TOP * scale
  return px >= actor.x - halfW && px <= actor.x + halfW && py >= top && py <= groundY + 4
}

window.addEventListener('mousemove', (e) => {
  const over = overCrab(e.clientX, e.clientY)
  if (over !== hovering) {
    hovering = over
    window.crabAPI.setInteractive(over)
    document.body.classList.toggle('hot', over)
  }
})

window.addEventListener('click', (e) => {
  if (!overCrab(e.clientX, e.clientY)) return
  pinned = !pinned
  // 被戳到會嚇一跳，往反方向跑掉
  actor.dir *= -1
  actor.pause = 0
  actor.speed = Math.max(actor.speed, 140)
})

window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  if (overCrab(e.clientX, e.clientY)) window.crabAPI.showMenu()
})

// ---------------------------------------------------------------- 主程序來的資料

window.crabAPI.onMetrics((data) => { metrics = data })
window.crabAPI.onConfig((data) => {
  config = { ...config, ...data }
  resize()
})
window.crabAPI.onLayout(({ width, height }) => resize(width, height))
window.crabAPI.getConfig().then((c) => { config = { ...config, ...c } }).catch(() => {})

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

resize()
requestAnimationFrame(frame)
