'use strict'

const { drawCrab, drawBubbles, loadToHue } = window.CrabArt
const { drawBird } = window.BirdArt

const canvas = document.getElementById('stage')
const ctx = canvas.getContext('2d')
const label = document.getElementById('label')

const GRAVITY = 2200       // px/s²，放開後的下墜加速度
const DRAG_THRESHOLD = 4   // 游標移動超過這麼多 px 才算拖曳，否則當成單擊
const CRAB_HALF_W = 58     // scale=1 時大約的半寬（含張開的腳與螯），用來判斷邊界與滑鼠命中
const CRAB_TOP = 68        // scale=1 時從腳底往上的高度
const BIRD_HALF_W = 44     // 小鳥的半寬與高度（高度含飛起來時離地的部分）
const BIRD_TOP = 92
const FLY_ON = 60          // 負載到這個程度小鳥改成展翅飛
const FLY_OFF = 50         // 掉到這個程度才落地走路，避免在門檻附近一直切換
const MIN_SPEED = 10       // px/s，0% 負載
const MAX_SPEED = 320      // px/s，100% 負載
const STRIDE = 26          // 走幾 px 算一個步伐週期

let config = { source: 'cpu', showLabel: true, scale: 1, mascot: 'crab' }
let metrics = { cpu: { load: 0, temp: null }, gpu: { load: null, temp: null }, load: 0 }

let viewW = window.innerWidth
let viewH = window.innerHeight
// 螃蟹所在的螢幕：{ id, left, right, top, bottom, ground }，座標都是視窗內座標，
// ground 是工具列上緣（腳踩的高度）。平常視窗只有一條，拖曳時會展開成涵蓋所有螢幕。
let displays = []
let home = { id: null, left: 0, right: viewW, top: 0, bottom: viewH, ground: viewH }
let cur = home
let expanded = false       // 視窗目前是否展開成涵蓋所有螢幕
let winOrigin = { x: 0, y: 0 } // 視窗左上角的螢幕座標，換版面時用來保持螃蟹的螢幕位置

const actor = {
  x: viewW / 2,
  lift: 0,                 // 腳底離地的高度（被拖起或下墜時 > 0）
  vy: 0,                   // 下墜速度，向下為正
  dir: 1,
  speed: 0,
  phase: 0,
  bob: 0,                  // 小鳥搖頭的相位（弧度）
  flap: 0,                 // 小鳥拍翅膀的相位
  flying: false,
  pause: 0,
  blink: 0,
  nextBlink: 2 + Math.random() * 4,
}

const bubbles = []
let pinned = false
let hovering = false
let drag = null            // 拖曳中：{ startX, startY, dx, dy, moved }，dx/dy 是抓取點相對腳底中心的偏移
let suppressClick = false
let lastT = performance.now()

// ---------------------------------------------------------------- 尺寸

function isBird() {
  return config.mascot === 'bird'
}

function halfW() {
  return (isBird() ? BIRD_HALF_W : CRAB_HALF_W) * config.scale
}

function topH() {
  return (isBird() ? BIRD_TOP : CRAB_TOP) * config.scale
}

function groundY() {
  return cur.ground
}

/** 主程序重排視窗（換螢幕、展開、收合）：保持螃蟹在螢幕上的位置不變。 */
function applyLayout(l) {
  const first = !displays.length
  const feetScreenX = winOrigin.x + actor.x
  const feetScreenY = winOrigin.y + groundY() - actor.lift
  winOrigin = { x: l.originX, y: l.originY }
  displays = l.displays
  expanded = l.expanded
  home = displays.find((d) => d.id === l.homeId) || displays[0]
  resize(l.width, l.height)

  const x = feetScreenX - winOrigin.x
  const y = feetScreenY - winOrigin.y
  const at = displays.find((d) => x >= d.left && x < d.right && y >= d.top && y <= d.bottom)
  if (!first && at && (expanded || at === home)) {
    cur = at
    actor.x = x
    actor.lift = Math.max(0, cur.ground - y)
  } else {
    // 原本的位置不在新視窗裡（例如從選單換螢幕）：回到該螢幕中央
    cur = home
    actor.x = (home.left + home.right) / 2
    actor.lift = 0
    actor.vy = 0
  }
}

function displayAt(x, y) {
  const inside = displays.find((d) => x >= d.left && x < d.right && y >= d.top && y < d.bottom)
  if (inside) return inside
  // 在螢幕之間的空隙或外面：挑水平距離最近的
  let best = displays[0] || home
  let bestDist = Infinity
  for (const d of displays) {
    const dist = x < d.left ? d.left - x : x >= d.right ? x - d.right : 0
    if (dist < bestDist) { best = d; bestDist = dist }
  }
  return best
}

function resize(w, h) {
  viewW = w || window.innerWidth
  viewH = h || window.innerHeight
  if (!displays.length) home = cur = { id: null, left: 0, right: viewW, top: 0, bottom: viewH, ground: viewH }
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(viewW * dpr)
  canvas.height = Math.round(viewH * dpr)
  canvas.style.width = `${viewW}px`
  canvas.style.height = `${viewH}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  actor.x = Math.min(actor.x, cur.right - halfW())
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
  const margin = halfW() + 6

  // 小鳥一直在搖頭，負載越高搖越快（每秒約 1.3 下到 8.8 下）
  actor.bob += dt * Math.PI * 2 * (1.3 + 7.5 * Math.pow(load / 100, 1.1))
  if (load >= FLY_ON) actor.flying = true
  else if (load < FLY_OFF) actor.flying = false
  if (actor.flying || actor.lift > 0) actor.flap += dt * (9 + load * 0.16)

  // 被抓住或在空中：不走路，腳亂蹬
  if (drag && drag.moved) {
    actor.speed = 0
    actor.phase += dt * 16
    updateBubbles(dt, load)
    updateLabel()
    return
  }
  if (actor.lift > 0) {
    actor.vy += GRAVITY * dt
    actor.lift -= actor.vy * dt
    actor.speed = 0
    actor.phase += dt * 16
    if (actor.lift <= 0) {
      actor.lift = 0
      // 落地時小彈一下，速度太小就直接站穩
      actor.vy = actor.vy > 500 ? -actor.vy * 0.22 : 0
      if (actor.vy < 0) actor.lift = 0.01
      actor.pause = 0.5
      // 完全站穩後，把視窗從「涵蓋所有螢幕」縮回這一台螢幕的底部，之後就固定在這台移動
      if (actor.lift === 0 && expanded) window.crabAPI.dropOnDisplay(cur.id)
    }
    updateBubbles(dt, load)
    updateLabel()
    return
  }

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

  if (actor.x < cur.left + margin) {
    actor.x = cur.left + margin
    actor.dir = 1
  } else if (actor.x > cur.right - margin) {
    actor.x = cur.right - margin
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

  ctx.save()
  ctx.translate(actor.x, groundY() - actor.lift)

  if (isBird()) {
    drawBird(ctx, {
      scale,
      phase: actor.phase,
      bob: actor.bob,
      flap: actor.flap,
      speed: actor.speed,
      dir: actor.dir,
      flying: actor.flying || actor.lift > 0,
      heat: clamp((load - 55) / 45, 0, 1),
      blink: actor.blink,
      time: now,
    })
    ctx.restore()
    return
  }

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
  const lx = Math.max(cur.left + 6, Math.min(cur.right - w - 6, actor.x - w / 2))
  const ly = Math.max(2, groundY() - actor.lift - topH() - 26 + (isBird() && !actor.flying ? 18 : 0))
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
  const feet = groundY() - actor.lift
  const hw = halfW()
  const top = feet - topH()
  return px >= actor.x - hw && px <= actor.x + hw && py >= top && py <= feet + 4
}

function setHover(over) {
  if (over === hovering) return
  hovering = over
  window.crabAPI.setInteractive(over)
  document.body.classList.toggle('hot', over)
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !overCrab(e.clientX, e.clientY)) return
  drag = {
    startX: e.clientX,
    startY: e.clientY,
    dx: e.clientX - actor.x,
    dy: e.clientY - (groundY() - actor.lift),
    moved: false,
  }
})

window.addEventListener('mousemove', (e) => {
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_THRESHOLD) {
      drag.moved = true
      actor.vy = 0
      actor.pause = 0
      // 視窗展開成涵蓋所有螢幕，才能拖到別台或抬得很高
      window.crabAPI.setExpanded(true)
    }
    if (drag.moved) {
      const margin = halfW() + 6
      const x = clamp(e.clientX - drag.dx, margin, viewW - margin)
      // 頭頂最高抬到視窗頂端；螃蟹在哪台螢幕上，就以那台的工具列上緣當地面
      const top = topH() + 4
      const rawFeet = Math.max(top, e.clientY - drag.dy)
      actor.x = x
      cur = displayAt(x, rawFeet)
      actor.lift = Math.max(0, cur.ground - rawFeet)
    }
    return
  }
  setHover(overCrab(e.clientX, e.clientY))
})

// 放開後 step() 會讓螃蟹自由落體到工具列上緣
window.addEventListener('mouseup', (e) => {
  if (!drag) return
  suppressClick = drag.moved
  const moved = drag.moved
  drag = null
  if (!moved) return
  // 落在螢幕邊緣或縫隙時，收進所在螢幕的範圍內
  const margin = halfW() + 6
  actor.x = clamp(actor.x, cur.left + margin, cur.right - margin)
  if (actor.lift <= 0) {
    actor.lift = 0
    if (expanded) window.crabAPI.dropOnDisplay(cur.id) // 直接放在地上，不用等下墜
  }
  setHover(overCrab(e.clientX, e.clientY))
})

window.addEventListener('click', (e) => {
  if (suppressClick) {
    suppressClick = false
    return
  }
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

// 游標直接離開視窗範圍時不會再有 mousemove，要在這裡把接管狀態還回去
document.addEventListener('mouseleave', () => {
  if (drag) {
    // 拖到視窗外就當作放開，不然會一直卡在被抓住的狀態
    suppressClick = false
    drag = null
  }
  setHover(false)
})

// ---------------------------------------------------------------- 主程序來的資料

window.crabAPI.onMetrics((data) => { metrics = data })
window.crabAPI.onConfig((data) => {
  config = { ...config, ...data }
  // 螃蟹被隱藏時主程序已經把穿透設回去了，這邊的狀態要跟著重置
  if (config.showCrab === false) {
    hovering = false
    document.body.classList.remove('hot')
  }
  resize()
})
window.crabAPI.onLayout(applyLayout)
window.crabAPI.getLayout().then((l) => { if (l) applyLayout(l) }).catch(() => {})
window.crabAPI.getConfig().then((c) => { config = { ...config, ...c } }).catch(() => {})

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

resize()
requestAnimationFrame(frame)
