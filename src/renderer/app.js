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
const BIRD_HALF_W = 46     // 小鳥的半寬與高度
const BIRD_TOP = 74
const MIN_SPEED = 10       // px/s，0% 負載
const MAX_SPEED = 320      // px/s，100% 負載
const STRIDE = 26          // 走幾 px 算一個步伐週期
const LABEL_ROOM = 30      // 飛行時頭頂要留給數值氣泡的空間

let config = { source: 'cpu', showLabel: true, scale: 1, mascot: 'crab', flyMode: 'bar', perchWindows: true }
let metrics = { cpu: { load: 0, temp: null }, gpu: { load: null, temp: null }, load: 0 }

let viewW = window.innerWidth
let viewH = window.innerHeight
// 吉祥物所在的螢幕：{ id, left, right, top, bottom, ground }，座標都是視窗內座標，
// ground 是工具列上緣（腳踩的高度）。平常視窗只有一條（小鳥到處飛時是整台螢幕），拖曳時會展開成涵蓋所有螢幕。
let displays = []
let home = { id: null, left: 0, right: viewW, top: 0, bottom: viewH, ground: viewH }
let cur = home
let expanded = false       // 視窗目前是否展開成涵蓋所有螢幕
let freeLayout = false     // 視窗目前是否蓋滿整台螢幕（小鳥到處飛）
let winOrigin = { x: 0, y: 0 } // 視窗左上角的螢幕座標，換版面時用來保持吉祥物的螢幕位置
let perchesScreen = []     // 其他視窗標題列可以停的線段（螢幕座標），主程序每 200ms 更新

const actor = {
  x: viewW / 2,
  lift: 0,                 // 腳底離地的高度（被拖起、下墜、小鳥飛行或停在視窗上時 > 0）
  vy: 0,                   // 螃蟹下墜速度，向下為正
  dir: 1,
  speed: 0,
  phase: 0,
  bob: 0,                  // 小鳥搖頭的相位（弧度）
  pause: 0,
  blink: 0,
  nextBlink: 2 + Math.random() * 4,
}

/** 小鳥的行為狀態：'perch' 停在某個地方（工具列或視窗標題列）| 'fly' 飛行中。 */
const bird = {
  mode: 'perch',
  perch: { kind: 'ground' }, // { kind: 'ground' | 'window', id, wx, y, x1, x2 }
  vx: 0,
  vy: 0,
  target: null,            // { x, y, perch } 下一個要飛去的點；perch 不是 null 就是要降落
  route: 0,                // 降落前還要先繞幾個點
  flightT: 0,
  act: 'idle',
  actT: 0,
  takeoffT: 3,
  walkDir: 1,
  hopY: 0,
  hopV: 0,
  flap: 0,
  spread: 0,
  tilt: 0,
  look: 0,
  lookTarget: 0,
  lookT: 0,
  headTilt: 0,
  headTiltTarget: 0,
  peck: 0,
  stretch: 0,
  stretchSide: 1,
  fluff: 0,
  squash: 0,
  loop: -1,                // 翻跟斗的進度（弧度），-1 = 沒在翻
  tailSwing: 0,
  seed: Math.random() * 100,
  time: 0,
}

const bubbles = []
let pinned = false
let hovering = false
let drag = null            // 拖曳中：{ startX, startY, dx, dy, moved }，dx/dy 是抓取點相對腳底中心的偏移
let suppressClick = false
let lastMouse = null       // 最後一次看到的游標位置；吉祥物自己移走時要靠它把滑鼠還給底下的視窗
let lastBox = null         // 上一格畫到的範圍，只清那一塊，整台螢幕大小的畫布才不會每格都全部重畫
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

function feetY() {
  return groundY() - actor.lift
}

/** 主程序重排視窗（換螢幕、展開、收合、切換飛行範圍）：保持吉祥物在螢幕上的位置不變。 */
function applyLayout(l) {
  const first = !displays.length
  const feetScreenX = winOrigin.x + actor.x
  const feetScreenY = winOrigin.y + feetY()
  winOrigin = { x: l.originX, y: l.originY }
  displays = l.displays
  expanded = l.expanded
  freeLayout = !!l.free
  home = displays.find((d) => d.id === l.homeId) || displays[0]
  resize(l.width, l.height)

  const x = feetScreenX - winOrigin.x
  const y = feetScreenY - winOrigin.y
  const at = displays.find((d) => x >= d.left && x < d.right && y >= d.top && y <= d.bottom)
  const fits = y - topH() >= 0 // 頭還在視窗裡（從整個螢幕切回工具列時，飛太高的小鳥就放不下了）
  if (!first && at && fits && (expanded || at === home)) {
    cur = at
    actor.x = x
    actor.lift = Math.max(0, cur.ground - y)
  } else {
    // 原本的位置不在新視窗裡（例如從選單換螢幕）：回到該螢幕中央
    cur = home
    actor.x = (home.left + home.right) / 2
    actor.lift = 0
    actor.vy = 0
    if (isBird()) landOn(groundPerch(), actor.x)
  }
  if (isBird() && bird.mode === 'fly' && bird.target) bird.target = null // 範圍變了，重新挑目標
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
  lastBox = null
  actor.x = Math.min(actor.x, cur.right - halfW())
}

window.addEventListener('resize', () => resize())

// ---------------------------------------------------------------- 主迴圈

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000) // 視窗被凍結後不要瞬移
  lastT = now

  step(dt)
  render(now)
  // 吉祥物從靜止的游標底下走開時不會有 mousemove，要自己檢查，不然整片視窗會一直擋著滑鼠
  if (hovering && !drag && lastMouse) setHover(overMascot(lastMouse.x, lastMouse.y))
  requestAnimationFrame(frame)
}

function step(dt) {
  const load = clamp(metrics.load || 0, 0, 100)
  updateBlink(dt)
  if (isBird()) stepBird(dt, load)
  else stepCrab(dt, load)
  updateBubbles(dt, load)
  updateLabel()
}

function stepCrab(dt, load) {
  const scale = config.scale
  const margin = halfW() + 6

  // 被抓住或在空中：不走路，腳亂蹬
  if (drag && drag.moved) {
    actor.speed = 0
    actor.phase += dt * 16
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
}

function updateBlink(dt) {
  actor.nextBlink -= dt
  if (actor.nextBlink <= 0) {
    actor.blink = Math.min(1, actor.blink + dt * 12)
    if (actor.blink >= 1) actor.nextBlink = 2 + Math.random() * 5
  } else if (actor.blink > 0) {
    actor.blink = Math.max(0, actor.blink - dt * 10)
  }
}

// ---------------------------------------------------------------- 小鳥

/** 整個螢幕飛：主程序把視窗蓋滿整台螢幕才算（切換途中視窗還沒換好時仍照工具列模式）。 */
function birdFree() {
  return freeLayout || (expanded && config.flyMode === 'free')
}

/** 飛行範圍（視窗座標，腳底的位置）。工具列模式就是視窗那一條，到處飛則是整台螢幕。 */
function flightBounds() {
  const m = halfW() + 6
  const top = Math.max(cur.top, 0) + topH() + LABEL_ROOM
  return { left: cur.left + m, right: cur.right - m, top, bottom: groundY() }
}

function groundPerch() {
  return { kind: 'ground', id: 'ground', wx: 0, y: groundY(), x1: cur.left, x2: cur.right }
}

/** 現在能停的地方：工具列上緣，加上（到處飛且有開的話）其他視窗沒被蓋住的標題列。 */
function surfaces() {
  const list = [groundPerch()]
  if (!birdFree() || !config.perchWindows) return list
  const minLen = halfW() * 2 + 10
  const minY = Math.max(cur.top, 0) + topH() + LABEL_ROOM
  for (const p of perchesScreen) {
    const y = p.y - winOrigin.y
    const x1 = Math.max(p.x1 - winOrigin.x, cur.left)
    const x2 = Math.min(p.x2 - winOrigin.x, cur.right)
    if (y < minY || y > groundY() - 20 || x2 - x1 < minLen) continue
    list.push({ kind: 'window', id: p.id, wx: p.wx - winOrigin.x, y, x1, x2 })
  }
  return list
}

/** 負載 → 精力（0..1）與過動程度（70% 以上才開始，100% 時 = 1）。 */
function energyOf(load) {
  return { e: Math.pow(load / 100, 0.9), hyper: clamp((load - 70) / 30, 0, 1) }
}

function rand(a, b) {
  return a + Math.random() * (b - a)
}

function takeoffDelay(e, hyper) {
  const base = birdFree() ? rand(4, 12) : rand(6, 15)
  return Math.max(0.4, base * (1 - 0.85 * Math.pow(e, 0.7)) * (1 - 0.5 * hyper))
}

function landOn(perch, x) {
  const m = halfW() + 4
  bird.mode = 'perch'
  bird.perch = perch
  bird.target = null
  bird.vx = 0
  bird.vy = 0
  bird.loop = -1
  bird.hopY = 0
  bird.hopV = 0
  actor.x = clamp(x, perch.x1 + m, perch.x2 - m)
  actor.lift = groundY() - perch.y
  bird.act = 'idle'
  bird.actT = rand(0.3, 1)
  const load = clamp(metrics.load || 0, 0, 100)
  const { e, hyper } = energyOf(load)
  bird.takeoffT = takeoffDelay(e, hyper)
}

function takeOff(awayX) {
  const load = clamp(metrics.load || 0, 0, 100)
  const { e } = energyOf(load)
  bird.mode = 'fly'
  bird.perch = null
  bird.target = null
  bird.flightT = 0
  bird.hopY = 0
  bird.hopV = 0
  bird.peck = 0
  bird.stretch = 0
  const dir = awayX === undefined ? (Math.random() < 0.5 ? -1 : 1) : actor.x >= awayX ? 1 : -1
  bird.vx = dir * rand(60, 140 + 200 * e)
  bird.vy = -rand(160, 240 + 220 * e)
  actor.dir = dir
  const { hyper } = energyOf(load)
  bird.route = birdFree()
    ? Math.floor(rand(1, 2.5 + 3 * e + 5 * hyper))
    : Math.floor(rand(0, 1.5 + 3 * e + 4 * hyper))
}

/** 下一個要飛去的點：先繞幾個空中的點，最後挑一個地方降落。 */
function nextTarget() {
  const b = flightBounds()
  if (bird.route > 0) {
    bird.route--
    const low = birdFree() ? b.top : Math.max(b.top, b.bottom - 220 * config.scale)
    bird.target = { x: rand(b.left, b.right), y: rand(low, b.bottom - 40), perch: null }
    return
  }
  const list = surfaces()
  // 用線段長度當權重，視窗的標題列多加一點，不然小鳥老是回到工具列
  const weights = list.map((s) => (s.x2 - s.x1) * (s.kind === 'window' ? 2.5 : 1))
  let r = Math.random() * weights.reduce((a, w) => a + w, 0)
  let pick = list[0]
  for (let i = 0; i < list.length; i++) {
    r -= weights[i]
    if (r <= 0) { pick = list[i]; break }
  }
  const m = halfW() + 4
  bird.target = { x: rand(pick.x1 + m, pick.x2 - m), y: pick.y, perch: pick }
}

/** 停著的地方還在不在、有沒有移動（視窗被拖走時跟著走）。 */
function refreshPerch() {
  const p = bird.perch
  if (!p) return null
  if (p.kind === 'ground') {
    const g = groundPerch()
    bird.perch = g
    return g
  }
  const m = halfW() + 4
  const candidates = surfaces().filter((s) => s.kind === 'window' && s.id === p.id)
  if (!candidates.length) return null
  // 同一個視窗可能被切成好幾段，挑小鳥腳下那一段（視窗水平移動的量要先加回去）
  const shifted = (s) => actor.x + (s.wx - p.wx)
  const found = candidates.find((s) => shifted(s) >= s.x1 + m * 0.5 && shifted(s) <= s.x2 - m * 0.5)
  if (!found) return null
  actor.x = clamp(shifted(found), found.x1 + m, found.x2 - m)
  bird.perch = found
  return found
}

function pickActivity(e, hyper) {
  const options = [
    ['idle', 3 - 2 * e],
    ['look', 2.5],
    ['walk', 2 + 3 * e],
    ['hop', 0.8 + 3 * hyper],
    ['peck', 1.5 * (1 - hyper)],
    ['preen', 1.4 * (1 - e)],
    ['stretch', 1 * (1 - e)],
    ['flutter', 0.4 + 3 * hyper],
  ]
  let r = Math.random() * options.reduce((a, [, w]) => a + Math.max(0, w), 0)
  let act = 'idle'
  for (const [name, w] of options) {
    r -= Math.max(0, w)
    if (r <= 0) { act = name; break }
  }
  bird.act = act
  bird.actT = rand(1, 3.5) * (1 - 0.55 * e)
  if (act === 'walk') bird.walkDir = Math.random() < 0.5 ? -1 : 1
  if (act === 'stretch') bird.stretchSide = Math.random() < 0.5 ? -1 : 1
  if (act === 'preen') bird.headTiltTarget = (Math.random() < 0.5 ? -1 : 1) * 0.7
}

function stepBird(dt, load) {
  const { e, hyper } = energyOf(load)
  bird.time += dt

  bird.squash = Math.max(0, bird.squash - dt * 5)
  bird.tailSwing = Math.sin(bird.time * (2 + 6 * e)) * (bird.mode === 'fly' ? 0.4 : 0.6)

  // 被抓起來：猛拍翅膀、腳亂踢
  if (drag && drag.moved) {
    bird.mode = 'fly'
    bird.perch = null
    bird.target = null
    bird.vx = 0
    bird.vy = 0
    bird.loop = -1
    bird.spread = approach(bird.spread, 1, dt * 8)
    bird.flap += dt * Math.PI * 2 * 9
    bird.tilt = approach(bird.tilt, 0, dt * 6)
    bird.look = approach(bird.look, 0, dt * 6)
    actor.phase += dt * 16
    return
  }

  if (bird.mode === 'perch') stepPerched(dt, e, hyper)
  else stepFlying(dt, e, hyper)
}

function stepPerched(dt, e, hyper) {
  const p = refreshPerch()
  if (!p) {
    // 視窗關掉、被蓋住或移走：嚇一跳飛起來
    takeOff()
    return
  }
  const m = halfW() + 4
  actor.lift = groundY() - p.y

  bird.spread = approach(bird.spread, bird.act === 'flutter' ? 0.75 : 0, dt * 7)
  bird.tilt = approach(bird.tilt, 0, dt * 6)
  bird.loop = -1
  if (bird.act === 'flutter') bird.flap += dt * Math.PI * 2 * (5 + 6 * hyper)

  // 原地小跳
  if (bird.hopY > 0 || bird.hopV > 0) {
    bird.hopY += bird.hopV * dt
    bird.hopV -= 1500 * dt
    if (bird.hopY <= 0) {
      bird.hopY = 0
      bird.hopV = 0
      bird.squash = Math.max(bird.squash, 0.4)
    }
  }

  bird.actT -= dt
  if (bird.actT <= 0) pickActivity(e, hyper)

  // 東張西望
  bird.lookT -= dt
  if (bird.lookT <= 0) {
    bird.lookTarget = bird.act === 'walk' ? bird.walkDir : rand(-1, 1)
    bird.lookT = bird.act === 'look' ? rand(0.3, 0.9) : rand(1, 3)
    if (bird.act === 'look') bird.headTiltTarget = rand(-0.45, 0.45)
  }

  let pecking = 0
  let walking = false
  switch (bird.act) {
    case 'walk': {
      walking = true
      const speed = (25 + 110 * e + 140 * hyper) * config.scale
      actor.x += bird.walkDir * speed * dt
      if (actor.x <= p.x1 + m || actor.x >= p.x2 - m) bird.walkDir *= -1
      actor.dir = bird.walkDir
      bird.lookTarget = bird.walkDir
      actor.speed = speed
      actor.phase += (speed * dt / (STRIDE * config.scale)) * Math.PI * 2
      // 邊走邊小跳步，越亢奮跳越多
      if (bird.hopY === 0 && Math.random() < dt * (1.5 + 5 * e)) bird.hopV = rand(90, 150 + 120 * hyper)
      break
    }
    case 'hop':
      if (bird.hopY === 0 && Math.random() < dt * (3 + 6 * hyper)) {
        bird.hopV = rand(140, 220 + 150 * hyper)
        if (Math.random() < 0.4) actor.dir *= -1
      }
      break
    case 'peck':
      pecking = Math.max(0, Math.sin(bird.time * 12)) * (Math.sin(bird.time * 1.7) > -0.3 ? 1 : 0)
      bird.lookTarget = bird.look * 0.5
      break
    case 'preen':
      pecking = 0.35 + Math.sin(bird.time * 9) * 0.1
      bird.lookTarget = Math.sign(bird.headTiltTarget)
      break
    default:
      break
  }
  if (!walking) actor.speed = approach(actor.speed, 0, dt * 300)

  bird.peck = approach(bird.peck, pecking, dt * 14)
  bird.stretch = approach(bird.stretch, bird.act === 'stretch' && bird.actT > 0.4 ? 1 : 0, dt * 3)
  bird.fluff = approach(bird.fluff, bird.act === 'preen' || bird.act === 'idle' ? 0.6 * (1 - e) : 0, dt * 2)
  if (bird.act !== 'preen' && bird.act !== 'look') bird.headTiltTarget = 0
  bird.headTilt = approach(bird.headTilt, bird.headTiltTarget, dt * 4)
  bird.look = approach(bird.look, bird.lookTarget, dt * (4 + 6 * hyper))

  actor.x = clamp(actor.x, p.x1 + m, p.x2 - m)

  bird.takeoffT -= dt
  if (bird.takeoffT <= 0) takeOff()
}

function stepFlying(dt, e, hyper) {
  const b = flightBounds()
  if (!bird.target) nextTarget()
  const t = bird.target
  bird.flightT += dt

  // 要降落的地方如果是視窗，視窗可能移動或不見了
  if (t.perch && t.perch.kind === 'window') {
    const s = surfaces().find((x) => x.kind === 'window' && x.id === t.perch.id && t.x >= x.x1 && t.x <= x.x2)
    if (!s) {
      bird.target = null
      return
    }
    t.y = s.y
    t.perch = s
  } else if (t.perch) {
    t.y = groundY()
    t.perch = groundPerch()
  }

  let y = feetY()
  const dx = t.x - actor.x
  const dy = t.y - y
  const dist = Math.hypot(dx, dy) || 1

  const maxV = (birdFree() ? 170 + 520 * e : 120 + 330 * e) + 260 * hyper
  const want = t.perch ? Math.min(maxV, dist * 2.4 + 30) : maxV
  let dvx = (dx / dist) * want
  let dvy = (dy / dist) * want
  // 過動時飛得歪七扭八
  if (hyper > 0) {
    const wobble = hyper * 280 * Math.sin(bird.time * 8 + bird.seed)
    dvx += (-dy / dist) * wobble
    dvy += (dx / dist) * wobble
  }
  const steer = 2.2 + 2.5 * e + 3 * hyper
  bird.vx += (dvx - bird.vx) * Math.min(1, dt * steer)
  bird.vy += (dvy - bird.vy) * Math.min(1, dt * steer)

  actor.x += bird.vx * dt
  y += bird.vy * dt
  // 碰到邊界就彈回來
  if (actor.x < b.left) { actor.x = b.left; bird.vx = Math.abs(bird.vx) }
  if (actor.x > b.right) { actor.x = b.right; bird.vx = -Math.abs(bird.vx) }
  if (y < b.top) { y = b.top; bird.vy = Math.abs(bird.vy) }
  if (y > b.bottom) { y = b.bottom; bird.vy = -Math.abs(bird.vy) * 0.5 }
  actor.lift = groundY() - y

  const speed = Math.hypot(bird.vx, bird.vy)
  actor.speed = speed
  if (Math.abs(bird.vx) > 15) actor.dir = bird.vx > 0 ? 1 : -1

  // 往下滑翔時拍得慢，爬升或過動時拍得快
  const gliding = bird.vy > 60 && hyper < 0.3 && dist > 80
  const flapHz = (3.2 + 5 * e + 4 * hyper + (bird.vy < -40 ? 1.5 : 0)) * (gliding ? 0.35 : 1)
  bird.flap += dt * Math.PI * 2 * flapHz
  bird.spread = approach(bird.spread, 1, dt * 8)
  bird.tilt = approach(bird.tilt, clamp(bird.vx / Math.max(1, maxV), -1, 1) * 0.5, dt * 6)
  bird.look = approach(bird.look, actor.dir * 0.8, dt * 6)
  bird.headTilt = approach(bird.headTilt, 0, dt * 4)
  bird.peck = approach(bird.peck, 0, dt * 8)
  bird.stretch = approach(bird.stretch, 0, dt * 8)
  bird.fluff = approach(bird.fluff, 0, dt * 4)

  // 過動時偶爾翻個跟斗
  if (bird.loop >= 0) {
    bird.loop += dt * Math.PI * 2 / 0.75
    if (bird.loop >= Math.PI * 2) bird.loop = -1
  } else if (hyper > 0 && !t.perch && dist > 160 && Math.random() < dt * 0.7 * hyper) {
    bird.loop = 0
  }

  if (!t.perch && dist < 40) {
    nextTarget()
  } else if (t.perch && (dist < 8 || (bird.flightT > 12 && dist < 60))) {
    landOn(t.perch, t.x)
    bird.squash = 1
    // 拖曳後放開、在工具列模式下落地：視窗縮回這台螢幕的底部
    if (expanded) window.crabAPI.dropOnDisplay(cur.id)
  } else if (bird.flightT > 20) {
    bird.route = 0 // 飛太久了（目標一直跑掉），直接找地方降落
    bird.target = null
    bird.flightT = 0
  }
}

/** 往 target 靠近，每秒最多 rate。 */
function approach(v, target, rate) {
  if (v < target) return Math.min(target, v + rate)
  return Math.max(target, v - rate)
}

// ---------------------------------------------------------------- 泡泡

function updateBubbles(dt, load) {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i]
    b.y -= b.vy * dt
    b.x += Math.sin(b.y * 0.08) * 0.3
    b.alpha -= dt * 0.35
    if (b.alpha <= 0) bubbles.splice(i, 1)
  }
  if (isBird()) return
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

// ---------------------------------------------------------------- 畫面

function render(now) {
  const load = clamp(metrics.load || 0, 0, 100)
  const scale = config.scale

  let rx = actor.x
  let ry = feetY()
  let tilt = 0
  if (isBird()) {
    ry -= bird.hopY
    tilt = bird.tilt
    if (bird.loop >= 0) {
      // 翻跟斗：沿著一個圓繞一圈，身體跟著轉一整圈
      const a = bird.loop
      const R = 34 * scale
      rx += actor.dir * R * Math.sin(a)
      ry -= R * (1 - Math.cos(a))
      tilt -= actor.dir * a
    }
  }

  // 只清掉上一格和這一格畫到的範圍
  const box = {
    x: rx - 180 * scale,
    y: ry - 230 * scale,
    w: 360 * scale,
    h: 320 * scale,
  }
  if (lastBox) ctx.clearRect(lastBox.x, lastBox.y, lastBox.w, lastBox.h)
  else ctx.clearRect(0, 0, viewW, viewH)
  ctx.clearRect(box.x, box.y, box.w, box.h)
  lastBox = box

  ctx.save()
  ctx.translate(rx, ry)

  if (isBird()) {
    const flying = bird.mode === 'fly'
    const carried = !!(drag && drag.moved)
    drawBird(ctx, {
      scale,
      phase: actor.phase,
      bob: actor.bob,
      bobAmp: 0, // 不再一直左右搖頭，頭的動作只剩轉頭、歪頭、啄
      flap: bird.flap,
      spread: bird.spread,
      tilt,
      look: bird.look,
      headTilt: bird.headTilt,
      peck: bird.peck,
      stretch: bird.stretch,
      stretchSide: bird.stretchSide,
      fluff: bird.fluff,
      squash: bird.squash,
      legs: carried ? 'dangle' : flying ? 'tuck' : bird.act === 'walk' && actor.speed > 1 ? 'walk' : 'stand',
      speed: actor.speed,
      dir: actor.dir,
      tailSwing: bird.tailSwing,
      heat: clamp((load - 55) / 45, 0, 1),
      blink: actor.blink,
      shadow: !flying && bird.hopY === 0,
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
  const birdHop = isBird() ? bird.hopY : 0
  const ly = Math.max(2, feetY() - birdHop - topH() - 26)
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

// 視窗預設整片穿透（工具列和其他視窗才點得到），只有游標壓在吉祥物身上時才短暫接管。
function overMascot(px, py) {
  const feet = feetY() - (isBird() ? bird.hopY : 0)
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
  if (e.button !== 0 || !overMascot(e.clientX, e.clientY)) return
  drag = {
    startX: e.clientX,
    startY: e.clientY,
    dx: e.clientX - actor.x,
    dy: e.clientY - feetY(),
    moved: false,
  }
})

window.addEventListener('mousemove', (e) => {
  lastMouse = { x: e.clientX, y: e.clientY }
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_THRESHOLD) {
      drag.moved = true
      actor.vy = 0
      actor.pause = 0
      if (isBird()) bird.hopY = 0
      // 視窗展開成涵蓋所有螢幕，才能拖到別台或抬得很高
      window.crabAPI.setExpanded(true)
    }
    if (drag.moved) {
      const margin = halfW() + 6
      const x = clamp(e.clientX - drag.dx, margin, viewW - margin)
      // 頭頂最高抬到視窗頂端；吉祥物在哪台螢幕上，就以那台的工具列上緣當地面
      const top = topH() + 4
      const rawFeet = Math.max(top, e.clientY - drag.dy)
      actor.x = x
      cur = displayAt(x, rawFeet)
      actor.lift = Math.max(0, cur.ground - rawFeet)
    }
    return
  }
  setHover(overMascot(e.clientX, e.clientY))
})

// 放開後：螃蟹自由落體到工具列上緣；小鳥拍拍翅膀自己飛走
window.addEventListener('mouseup', (e) => {
  if (!drag) return
  suppressClick = drag.moved
  const moved = drag.moved
  drag = null
  if (!moved) return
  // 落在螢幕邊緣或縫隙時，收進所在螢幕的範圍內
  const margin = halfW() + 6
  actor.x = clamp(actor.x, cur.left + margin, cur.right - margin)
  if (isBird()) {
    if (actor.lift <= 0) {
      actor.lift = 0
      landOn(groundPerch(), actor.x)
      if (expanded) window.crabAPI.dropOnDisplay(cur.id)
    } else {
      bird.mode = 'fly'
      bird.target = null
      bird.flightT = 0
      bird.route = config.flyMode === 'free' ? 1 : 0
      // 到處飛的時候整台螢幕都是範圍，放開就可以把視窗縮回這台螢幕
      if (expanded && config.flyMode === 'free') window.crabAPI.dropOnDisplay(cur.id)
    }
  } else if (actor.lift <= 0) {
    actor.lift = 0
    if (expanded) window.crabAPI.dropOnDisplay(cur.id) // 直接放在地上，不用等下墜
  }
  setHover(overMascot(e.clientX, e.clientY))
})

window.addEventListener('click', (e) => {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (!overMascot(e.clientX, e.clientY)) return
  pinned = !pinned
  if (isBird()) {
    // 被戳到會嚇一跳飛走
    takeOff(e.clientX)
    return
  }
  // 被戳到會嚇一跳，往反方向跑掉
  actor.dir *= -1
  actor.pause = 0
  actor.speed = Math.max(actor.speed, 140)
})

window.addEventListener('dblclick', (e) => {
  if (overMascot(e.clientX, e.clientY)) window.crabAPI.openSettings()
})

window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  if (overMascot(e.clientX, e.clientY)) window.crabAPI.showMenu()
})

// 游標直接離開視窗範圍時不會再有 mousemove，要在這裡把接管狀態還回去
document.addEventListener('mouseleave', () => {
  if (drag) {
    // 拖到視窗外就當作放開，不然會一直卡在被抓住的狀態
    suppressClick = false
    drag = null
  }
  lastMouse = null
  setHover(false)
})

// ---------------------------------------------------------------- 主程序來的資料

window.crabAPI.onMetrics((data) => { metrics = data })
window.crabAPI.onConfig((data) => {
  const wasBird = isBird()
  config = { ...config, ...data }
  // 吉祥物被隱藏時主程序已經把穿透設回去了，這邊的狀態要跟著重置
  if (config.showCrab === false) {
    hovering = false
    document.body.classList.remove('hot')
  }
  // 從螃蟹換成小鳥：從地上開始
  if (isBird() && !wasBird) {
    actor.lift = 0
    landOn(groundPerch(), actor.x)
  }
  resize()
})
window.crabAPI.onLayout(applyLayout)
window.crabAPI.onPerches((list) => { perchesScreen = Array.isArray(list) ? list : [] })
window.crabAPI.getLayout().then((l) => { if (l) applyLayout(l) }).catch(() => {})
window.crabAPI.getConfig().then((c) => {
  config = { ...config, ...c }
  if (isBird()) landOn(groundPerch(), actor.x)
}).catch(() => {})

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

resize()
requestAnimationFrame(frame)
