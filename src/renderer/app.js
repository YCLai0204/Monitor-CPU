'use strict'

const { drawBubbles, loadToHue } = window.CrabArt
const ART = window.MascotArt || {}

/**
 * 吉祥物清單。engine 決定動作方式：
 *   'crawl'  像螃蟹：在工具列上走，整個畫面時沿著螢幕四周爬、跳到視窗上沿著視窗爬
 *   'fly'    像小鳥：走走跳跳、起飛降落，整個畫面時到處飛、停在標題列
 * halfW / top 是 scale = 1 時的半寬與從腳底往上的高度（邊界、滑鼠命中、標籤位置用），
 * speed 是相對於螃蟹的移動速度，stride 是走幾 px 算一步（沒寫就跟螃蟹一樣），bubbles 是低負載時吐泡泡。
 * climber 是「攀爬型」的爬行（像黑熊爬樹）：不倒掛、牆只爬到一半，要從視窗側邊爬上去，
 * 所以只去底部貼近工具列、搆得到的視窗；food 是畫食物的方法，有的話會在沒被移動的視窗上偷偷放食物。
 * run 是負載高時改用四腳衝刺：負載到 on% 開始、掉到 off% 以下才停（避免在門檻附近一直切換），速度乘上 boost。
 *
 * 新增動物：寫一支畫法（掛到 window.MascotArt，見 bear.js），在 index.html 載入，
 * 在這裡加一筆，主程序與設定視窗的 MASCOTS 也各加一筆。
 */
const MASCOT_DEFS = {
  crab: {
    engine: 'crawl',
    halfW: 58,
    top: 68,
    speed: 1,
    bubbles: true,
    draw: (c, o) => window.CrabArt.drawCrab(c, { ...o, hue: loadToHue(o.load) }),
  },
  bird: { engine: 'fly', halfW: 46, top: 74, draw: window.BirdArt.drawBird },
  bear: {
    engine: 'crawl',
    climber: true,
    halfW: 36,
    top: 84,
    speed: 0.75,
    stride: 70,
    draw: ART.bear && ART.bear.draw,
    food: ART.bear && ART.bear.drawFood,
    run: { on: 50, off: 45, boost: 1.5 },
  },
}

const canvas = document.getElementById('stage')
const ctx = canvas.getContext('2d')
const label = document.getElementById('label')

const GRAVITY = 2200       // px/s²，放開後的下墜加速度
const DRAG_THRESHOLD = 4   // 游標移動超過這麼多 px 才算拖曳，否則當成單擊
const MIN_SPEED = 10       // px/s，0% 負載
const MAX_SPEED = 320      // px/s，100% 負載
const STRIDE = 26          // 走幾 px 算一個步伐週期
const LABEL_ROOM = 30      // 飛行時頭頂要留給數值氣泡的空間

let config = { source: 'cpu', showLabel: true, scale: 1, mascot: 'crab', roamScreen: false, perchWindows: true }
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
let windowsScreen = []     // 其他視窗的外框（螢幕座標），螃蟹沿著爬

const actor = {
  x: viewW / 2,
  lift: 0,                 // 腳底離地的高度（被拖起、下墜、小鳥飛行或停在視窗上時 > 0）
  vy: 0,                   // 螃蟹下墜速度，向下為正
  dir: 1,
  speed: 0,
  phase: 0,
  bob: 0,                  // 小鳥搖頭的相位（弧度）
  running: false,          // 負載高、正在衝刺
  look: 0,                 // 爬行類臉朝哪邊：-1 左、0 正面、1 右
  lookY: 0,                // 爬牆時往上（-1）或往下（1）看
  lastY: 0,                // 上一格的腳底高度，用來判斷正在往上還是往下爬
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

/**
 * 螃蟹在整個螢幕模式的狀態。螢幕四周和每個視窗的外框都當成一圈「環」，
 * 螃蟹貼著環爬（frac 是走到這圈的幾分之幾），身體朝著 n（法線）那一側。
 */
const crawl = {
  mode: 'fall',            // 'walk' 貼著環爬 | 'fall' 跳下或掉下來 | 'held' 被抓著
  loop: { kind: 'screen' },// { kind: 'screen' } 螢幕內側 | { kind: 'window', id } 某個視窗的外側
  frac: 0,
  move: 1,                 // 1 = 順時針，-1 = 逆時針
  vx: 0,
  vy: 0,
  angle: 0,                // 畫的時候的旋轉角度（平滑追著法線）
  nx: 0,                   // 目前身體朝的方向（法線），掉落或被抓著時是正上方
  ny: -1,
  mission: null,           // { id, lx }：要去哪個視窗，先爬到天花板上 lx 的位置再跳下去
  missionT: 6,             // 多久後想去別的視窗
  stayT: 0,                // 在視窗上待多久
  leaving: false,          // 待夠了，等爬到側邊或底部就跳下去
  boost: 0,                // 被戳到後暴衝的剩餘時間
  // 以下是攀爬型（黑熊）才用的
  climbLimit: 0.45,        // 這次牆最多爬到螢幕高度的幾成
  peek: false,             // 停在牆上東張西望
  seatX: null,             // 爬上視窗後要走到哪裡坐
  exitSide: null,          // 要從視窗哪一側爬下來
  sitT: 0,                 // 坐著的剩餘時間
  eatT: 0,                 // 吃東西的剩餘時間
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

function mascotDef() {
  const def = MASCOT_DEFS[config.mascot]
  return def && def.draw ? def : MASCOT_DEFS.crab // 畫法沒載入成功就退回螃蟹，不會整個畫面空白
}

/** 用小鳥那套動作（飛行）的吉祥物。 */
function isFlyer() {
  return mascotDef().engine === 'fly'
}

/** 走幾 px 算一個步伐週期（scale = 1 時）。螃蟹是小碎步，大型動物步伐長，手腳才不會擺得像在抖。 */
function strideOf() {
  return mascotDef().stride || STRIDE
}

/** 移動速度倍率：動物本身的快慢，衝刺時再加快。 */
function speedFactor() {
  const def = mascotDef()
  return (def.speed || 1) * (actor.running && def.run ? def.run.boost : 1)
}

function halfW() {
  return mascotDef().halfW * config.scale
}

function topH() {
  return mascotDef().top * config.scale
}

/**
 * 可以在整個畫面活動（每種吉祥物共用的開關）：主程序把視窗蓋滿整台螢幕才算，
 * 切換途中視窗還沒換好時仍照工具列模式。拖曳中視窗會展開成所有螢幕，這時看設定。
 * 新增動物時，在 step() 裡依這個判斷分成「工具列」與「整個畫面」兩種動作即可。
 */
function roamFree() {
  return freeLayout || (expanded && !!config.roamScreen)
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
    if (isFlyer()) landOn(groundPerch(), actor.x)
  }
  if (isFlyer() && bird.mode === 'fly' && bird.target) bird.target = null // 範圍變了，重新挑目標
  // 版面變了，螃蟹原本貼著的邊可能已經不一樣：先放手掉下去，落地時重新貼上
  if (crawlFree() && crawl.mode !== 'held') crabFall(0, 0)
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
  if (isFlyer()) stepBird(dt, load)
  else {
    // 負載高時改用衝刺（有設定 run 的動物才有）
    const run = mascotDef().run
    if (!run) actor.running = false
    else if (load >= run.on) actor.running = true
    else if (load < run.off) actor.running = false
    stepCrab(dt, load)
    if (mascotDef().food) updateFood(dt)
    // 走路時臉轉向前進方向，停下來或爬牆時慢慢轉回正面（螃蟹的畫法不看這個）；停在牆上時東張西望
    const pose = crawlPose()
    let facing = (pose === 'walk' || pose === 'run') && actor.speed > 5 ? actor.dir : 0
    // 扒著牆時臉稍微朝牆，往上爬就抬頭、往下爬就低頭
    let facingY = 0
    const fy = feetY()
    if (mascotDef().climber && wallSide()) {
      facing = wallSide() * 0.35
      if (actor.speed > 5 && Math.abs(fy - actor.lastY) > 0.05) facingY = fy < actor.lastY ? -1 : 1
    }
    actor.lastY = fy
    if (crawl.peek && crawlFree()) facing = Math.sin(performance.now() / 450)
    actor.look = approach(actor.look, facing, dt * 5)
    actor.lookY = approach(actor.lookY, facingY, dt * 4)
  }
  updateBubbles(dt, load)
  updateLabel()
}

function stepCrab(dt, load) {
  if (crawlFree()) {
    stepCrabFree(dt, load)
    return
  }
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
  const targetSpeed = (MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.pow(load / 100, 1.2)) * speedFactor()

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
  actor.phase += (Math.abs(dx) / (strideOf() * scale)) * Math.PI * 2 + dt * 1.1
}

// ---------------------------------------------------------------- 螃蟹：整個螢幕爬

const CORNER_IN = 0.75     // 螢幕內側轉角的半徑（乘上螃蟹高度），轉過去時身體才不會跑出畫面
const CORNER_OUT = 6       // 視窗外側轉角的半徑（px，乘上 scale）
const MISSION_SPEED = 110  // 要去別的視窗時至少用這個速度爬（px/s，乘上 scale），低負載才不會爬半天
const CLIMB_GAP = 25       // 攀爬型貼在牆上時，身體中心離牆多遠（px，乘上 scale）

function crawlFree() {
  return !isFlyer() && roamFree()
}

/** 其他視窗的外框（視窗座標），排除最大化和不在這台螢幕上的。 */
function windowRects() {
  const list = []
  const dw = cur.right - cur.left
  const dh = cur.ground - cur.top
  for (const w of windowsScreen) {
    const l = w.x - winOrigin.x
    const t = w.y - winOrigin.y
    if (w.w >= dw - 8 && w.h >= dh - 8) continue
    const cx = l + w.w / 2
    const cy = t + w.h / 2
    if (cx < cur.left || cx > cur.right || cy < cur.top || cy > cur.ground) continue
    list.push({
      id: w.id,
      l: Math.max(l, cur.left),
      t: Math.max(t, cur.top),
      r: Math.min(l + w.w, cur.right),
      b: Math.min(t + w.h, cur.ground),
    })
  }
  return list
}

/**
 * (x, y) 這一點是不是被比 id 這個視窗更上層的視窗蓋住了。
 * windowsScreen 依 z-order 排（最上層在前），所以只看排在它前面的。
 */
function coveredAt(id, x, y) {
  const sx = x + winOrigin.x
  const sy = y + winOrigin.y
  const pad = 2
  for (const w of windowsScreen) {
    if (w.id === id) return false
    if (sx > w.x + pad && sx < w.x + w.w - pad && sy > w.y + pad && sy < w.y + w.h - pad) return true
  }
  return false
}

/** 可以落腳的上緣：工具列上緣，加上（有開的話）其他視窗沒被蓋住的頂端。 */
function crabTops() {
  const tops = [{ kind: 'screen', id: 'screen', y: groundY(), x1: cur.left, x2: cur.right }]
  if (!config.perchWindows) return tops
  const ids = new Set(windowRects().map((w) => w.id))
  const minY = cur.top + headroom()
  for (const p of perchesScreen) {
    if (!ids.has(p.id)) continue
    const y = p.y - winOrigin.y
    const x1 = Math.max(p.x1 - winOrigin.x, cur.left)
    const x2 = Math.min(p.x2 - winOrigin.x, cur.right)
    if (y < minY || y > groundY() - 20 || x2 - x1 < halfW() * 2 + 10) continue
    tops.push({ kind: 'window', id: p.id, y, x1, x2 })
  }
  return tops
}

/** 螃蟹貼著的那一圈：螢幕的話貼內側，視窗的話貼外側。視窗不見了回傳 null。 */
function loopShape(loop) {
  if (loop.kind === 'screen') {
    return { rect: { l: cur.left, t: cur.top, r: cur.right, b: groundY() }, rho: topH() * CORNER_IN, outside: false }
  }
  if (!config.perchWindows) return null
  const rect = windowRects().find((w) => w.id === loop.id)
  return rect ? { rect, rho: CORNER_OUT * config.scale, outside: true } : null
}

/** 圓角矩形拆成順時針的 8 段：上、右上角、右、右下角、下、左下角、左、左上角。 */
function loopSegments({ rect, rho, outside }) {
  const { l, t, r, b } = rect
  const p = Math.max(0, Math.min(rho, (r - l) / 2, (b - t) / 2))
  const segs = [
    { kind: 'line', ax: l + p, ay: t, bx: r - p, by: t, ux: 0, uy: -1 },
    { kind: 'arc', cx: r - p, cy: t + p, a0: -Math.PI / 2 },
    { kind: 'line', ax: r, ay: t + p, bx: r, by: b - p, ux: 1, uy: 0 },
    { kind: 'arc', cx: r - p, cy: b - p, a0: 0 },
    { kind: 'line', ax: r - p, ay: b, bx: l + p, by: b, ux: 0, uy: 1 },
    { kind: 'arc', cx: l + p, cy: b - p, a0: Math.PI / 2 },
    { kind: 'line', ax: l, ay: b - p, bx: l, by: t + p, ux: -1, uy: 0 },
    { kind: 'arc', cx: l + p, cy: t + p, a0: Math.PI },
  ]
  for (const s of segs) s.len = s.kind === 'line' ? Math.hypot(s.bx - s.ax, s.by - s.ay) : (Math.PI / 2) * p
  return { segs, p, outside, total: segs.reduce((a, s) => a + s.len, 0) || 1 }
}

/** 環上 frac 的位置；n 是身體朝的方向（螢幕內側朝裡、視窗外側朝外），t 是順時針的前進方向。 */
function pointOnLoop(path, frac) {
  let d = (((frac % 1) + 1) % 1) * path.total
  const last = path.segs[path.segs.length - 1]
  for (const s of path.segs) {
    if (d <= s.len || s === last) {
      const k = s.len ? Math.min(1, d / s.len) : 0
      let x
      let y
      let ux = s.ux
      let uy = s.uy
      if (s.kind === 'line') {
        x = s.ax + (s.bx - s.ax) * k
        y = s.ay + (s.by - s.ay) * k
      } else {
        const a = s.a0 + (k * Math.PI) / 2
        ux = Math.cos(a)
        uy = Math.sin(a)
        x = s.cx + ux * path.p
        y = s.cy + uy * path.p
      }
      const sign = path.outside ? 1 : -1
      return { x, y, nx: ux * sign, ny: uy * sign, tx: -uy, ty: ux }
    }
    d -= s.len
  }
  return null
}

/** 離 (x, y) 最近的直線段位置換成 frac，落地時用來貼上去。 */
function fracAt(path, x, y) {
  let best = Infinity
  let bestD = 0
  let d0 = 0
  for (const s of path.segs) {
    if (s.kind === 'line' && s.len > 0) {
      const k = clamp(((x - s.ax) * (s.bx - s.ax) + (y - s.ay) * (s.by - s.ay)) / (s.len * s.len), 0, 1)
      const dist = Math.hypot(s.ax + (s.bx - s.ax) * k - x, s.ay + (s.by - s.ay) * k - y)
      if (dist < best) {
        best = dist
        bestD = d0 + k * s.len
      }
    }
    d0 += s.len
  }
  return bestD / path.total
}

/** 畫 (0, -1) 朝上的螃蟹要轉幾度，身體才會朝著 n。 */
function angleOfNormal(nx, ny) {
  return Math.atan2(nx, -ny)
}

function approachAngle(a, target, rate) {
  const d = Math.atan2(Math.sin(target - a), Math.cos(target - a))
  return Math.abs(d) <= rate ? target : a + Math.sign(d) * rate
}

/**
 * 爬行類身體中心（視窗座標）。旋轉都繞這裡轉，從天花板放手翻正時才不會甩出畫面。
 * 攀爬型（黑熊）不跟著牆轉，貼在牆上時身體直立、離牆半個身寬，手腳伸過去扒著牆。
 */
function crabCenter() {
  const h2 = topH() * 0.5
  if (mascotDef().climber) {
    const side = Math.abs(crawl.nx)
    const d = h2 + (CLIMB_GAP * config.scale - h2) * side
    return { x: actor.x + crawl.nx * d, y: feetY() + crawl.ny * d }
  }
  return { x: actor.x + crawl.nx * h2, y: feetY() + crawl.ny * h2 }
}

/** 攀爬型貼在牆上時，牆在身體的哪一邊（1 右、-1 左、0 不在牆上）。 */
function wallSide() {
  if (!crawlFree() || crawl.mode !== 'walk' || Math.abs(crawl.nx) < 0.7) return 0
  return crawl.nx < 0 ? 1 : -1
}

function crabFall(vx, vy) {
  // 離開環的那一刻保持身體中心不動，之後以「轉正」的腳底位置做物理
  if (crawl.mode === 'walk') {
    const c = crabCenter()
    actor.x = c.x
    actor.lift = groundY() - (c.y + topH() * 0.5)
  }
  crawl.nx = 0
  crawl.ny = -1
  crawl.mode = 'fall'
  crawl.vx = vx
  crawl.vy = vy
  resetCrawlPlans()
}

/** 換地方（掉下去、落地）時，原本的計畫都作廢。 */
function resetCrawlPlans() {
  crawl.mission = null
  crawl.leaving = false
  crawl.seatX = null
  crawl.exitSide = null
  crawl.sitT = 0
  crawl.eatT = 0
  crawl.peek = false
}

function crabLand(top, x) {
  const loop = top.kind === 'window' ? { kind: 'window', id: top.id } : { kind: 'screen' }
  const shape = loopShape(loop)
  if (!shape) return false
  const path = loopSegments(shape)
  const load = clamp(metrics.load || 0, 0, 100)
  const e = load / 100
  crawl.mode = 'walk'
  crawl.nx = 0
  crawl.ny = -1
  crawl.loop = loop
  crawl.frac = fracAt(path, x, top.y)
  crawl.move = Math.random() < 0.5 ? -1 : 1
  crawl.vx = 0
  crawl.vy = 0
  resetCrawlPlans()
  crawl.stayT = rand(10, 25) * (1 - 0.5 * e)
  crawl.missionT = rand(6, 16) * (1 - 0.5 * e)
  actor.pause = 0.4
  // 拖曳後放開落地：視窗縮回這台螢幕
  if (expanded) window.crabAPI.dropOnDisplay(cur.id)
  return true
}

/** 挑一個視窗去：記下要從天花板哪裡跳下去。 */
function pickCrabMission() {
  const m = halfW() + 4
  const options = crabTops().filter((s) => s.kind === 'window' && s.y - cur.top > topH() * 2.2)
  if (!options.length) return
  const pick = options[Math.floor(Math.random() * options.length)]
  crawl.mission = { id: pick.id, lx: rand(pick.x1 + m, pick.x2 - m) }
}

// ---------------------------------------------------------------- 攀爬型（黑熊）：不倒掛、從視窗側邊爬上去、吃食物

const REACH = 1.2          // 視窗底部離工具列多近才搆得到（乘上身高）
const WALL_CLIMB = [0.3, 0.55] // 牆最多爬到螢幕高度的幾成（每次隨機）
const FOOD_STILL_MS = 20000 // 視窗多久沒移動才放食物
const FOOD_COOLDOWN_MS = 25000 // 吃完多久之後才會再放
const FOOD_EXPIRE_MS = 120000 // 一直沒吃到就收掉

const foods = []           // { id: 視窗 id, off: 離視窗左緣多遠（px）, born }
const windowStill = new Map() // 視窗 id → { key: 位置大小, since: 從什麼時候沒再動 }
let lastAte = 0
let foodCheckT = 2

/** 環上可以走的那一段（從哪個 d 開始、多長）：螢幕是右牆 → 工具列 → 左牆，視窗是左側 → 頂端 → 右側。 */
function climberChain(path, onWindow) {
  const starts = []
  let d = 0
  for (const s of path.segs) {
    starts.push(d)
    d += s.len
  }
  const segs = onWindow ? [6, 7, 0, 1, 2] : [2, 3, 4, 5, 6]
  return { start: starts[segs[0]], len: segs.reduce((a, i) => a + path.segs[i].len, 0) }
}

function chainPos(path, chain, frac) {
  return clamp((frac * path.total - chain.start + path.total) % path.total, 0, chain.len)
}

function chainFrac(path, chain, u) {
  return ((chain.start + u) % path.total) / path.total
}

/** 站或坐在視窗頂端時，頂端上方至少要有多少空間（身高再多一點），頭才不會跑出螢幕。 */
function headroom() {
  return topH() + 10 * config.scale
}

/**
 * 黑熊爬不上這個視窗的原因，爬得上去就回傳 null。
 * 要底部貼近工具列（搆得到側邊）、頂端上方坐得下、頂端沒被別的視窗蓋住、旁邊有空間走過去。
 */
function climbIssue(r, topIds) {
  const reach = Math.round(topH() * REACH)
  const gap = Math.round(groundY() - r.b)
  const above = Math.round(r.t - cur.top)
  const m = halfW() * 2
  if (gap > reach) return `底部離工具列 ${gap}px，太高搆不到（要 ${reach}px 以內）`
  if (above < headroom()) return `頂端上方只有 ${above}px，黑熊目前 ${Math.round(topH())}px 高，坐不下（要 ${Math.round(headroom())}px 以上）`
  if (r.b - r.t <= topH() * 1.2) return `視窗太矮（${Math.round(r.b - r.t)}px）`
  if (!topIds.has(r.id)) return '頂端被其他視窗蓋住，或露出來的地方太窄'
  if (!(r.l - m > cur.left || r.r + m < cur.right)) return '左右兩邊都貼著螢幕邊緣，沒有地方走過去爬'
  return null
}

/** 底部貼近工具列、黑熊搆得到側邊的視窗。 */
function reachableWindows() {
  const topIds = new Set(crabTops().filter((s) => s.kind === 'window').map((s) => s.id))
  return windowRects().filter((r) => !climbIssue(r, topIds))
}

/** 走到視窗哪一側的地上，準備往上爬：挑離自己近、旁邊有空間的那一側。 */
function climbSideOf(r) {
  const m = halfW() + 6
  const sides = []
  if (r.l - m * 2 > cur.left) sides.push({ side: -1, x: r.l - m })
  if (r.r + m * 2 < cur.right) sides.push({ side: 1, x: r.r + m })
  sides.sort((a, b) => Math.abs(a.x - actor.x) - Math.abs(b.x - actor.x))
  return sides[0] || null
}

/** 這一格要畫的食物位置（不是會吃東西的動物、或不在整個畫面模式就不畫）。 */
function drawableFoods() {
  if (!mascotDef().food || !crawlFree() || !config.perchWindows) return []
  return foods.map(foodPos).filter(Boolean)
}

/**
 * 食物的位置（視窗座標）。食物有三種狀態：
 *   放在視窗頂端（id 是那個視窗，off 是離視窗左緣多遠，跟著視窗走）
 *   往下掉（id 是 null，sx / sy 是螢幕座標，vy 是下墜速度）
 *   落在工具列上（id 是 null、landed 是 true）
 */
function foodPos(f) {
  if (f.id === null) return { x: f.sx - winOrigin.x, y: f.sy - winOrigin.y }
  const w = windowsScreen.find((x) => x.id === f.id)
  if (!w) return { x: f.sx - winOrigin.x, y: f.sy - winOrigin.y }
  return { x: w.x - winOrigin.x + f.off, y: w.y - winOrigin.y }
}

/** 在某個視窗頂端放一顆食物。 */
function placeFood(id, x) {
  const w = windowsScreen.find((v) => v.id === id)
  if (!w) return
  const p = { x, y: w.y - winOrigin.y }
  foods.push({ id, off: x - (w.x - winOrigin.x), sx: p.x + winOrigin.x, sy: p.y + winOrigin.y, vy: 0, landed: false, born: performance.now() })
}

/** 食物所在的視窗還在不在（關掉、縮小、最大化、移到別的螢幕都算不在）。 */
function foodWindowGone(f) {
  return f.id !== null && !windowRects().some((r) => r.id === f.id)
}

/** 食物離開視窗，從現在的位置往下掉。 */
function dropFood(f) {
  f.id = null
  f.vy = 0
  f.landed = false
}

/** 記下每個視窗從什麼時候開始沒再移動；視窗不見了，它上面的食物就掉下來（被蓋住的在 stepFoods 處理）。 */
function trackWindowStillness() {
  const now = performance.now()
  const seen = new Set()
  for (const w of windowsScreen) {
    const key = `${w.x},${w.y},${w.w},${w.h}`
    const prev = windowStill.get(w.id)
    if (!prev || prev.key !== key) windowStill.set(w.id, { key, since: now })
    seen.add(w.id)
  }
  for (const id of windowStill.keys()) if (!seen.has(id)) windowStill.delete(id)
  for (const f of foods) if (foodWindowGone(f)) dropFood(f)
}

/** 食物往下掉：碰到的第一個上緣（其他視窗頂端或工具列）就停在那裡。 */
function stepFoods(dt) {
  for (const f of foods) {
    if (f.id !== null) {
      const at = foodPos(f)
      // 視窗不見了，或食物那個位置被別的視窗蓋住了：掉下去
      if (foodWindowGone(f) || coveredAt(f.id, at.x, at.y)) {
        dropFood(f)
      } else {
        // 跟著視窗走，順便記下螢幕座標，視窗突然不見時才知道從哪裡開始掉
        const p = foodPos(f)
        f.sx = p.x + winOrigin.x
        f.sy = p.y + winOrigin.y
        continue
      }
    }
    if (f.landed) {
      f.sy = groundY() + winOrigin.y // 工具列高度可能變了
      continue
    }
    const x = clamp(f.sx - winOrigin.x, cur.left + 20, cur.right - 20)
    const y0 = f.sy - winOrigin.y
    f.vy += GRAVITY * dt
    const y1 = y0 + f.vy * dt
    let hit = null
    for (const s of crabTops()) {
      if (y0 <= s.y + 0.5 && y1 >= s.y && x >= s.x1 && x <= s.x2 && (!hit || s.y < hit.y)) hit = s
    }
    if (!hit && y1 >= groundY()) hit = crabTops()[0]
    f.sx = x + winOrigin.x
    if (!hit) {
      f.sy = y1 + winOrigin.y
    } else if (hit.kind === 'window') {
      const w = windowsScreen.find((v) => v.id === hit.id)
      f.id = hit.id
      f.off = x - (w.x - winOrigin.x)
      f.sy = hit.y + winOrigin.y
    } else {
      f.landed = true
      f.sy = groundY() + winOrigin.y
    }
  }
}

/** 有視窗一段時間沒被移動，就在它頂端偷偷放一顆食物（一次只放一顆）。 */
function updateFood(dt) {
  const now = performance.now()
  for (let i = foods.length - 1; i >= 0; i--) if (now - foods[i].born > FOOD_EXPIRE_MS) foods.splice(i, 1)
  stepFoods(dt)
  foodCheckT -= dt
  if (foodCheckT > 0) return
  foodCheckT = 2
  const def = mascotDef()
  if (!def.food || !crawlFree() || !config.perchWindows || foods.length || now - lastAte < FOOD_COOLDOWN_MS) return
  const m = halfW() + 10
  const candidates = reachableWindows().filter((r) => {
    const still = windowStill.get(r.id)
    return still && now - still.since >= FOOD_STILL_MS
  })
  if (!candidates.length) return
  const r = candidates[Math.floor(Math.random() * candidates.length)]
  const top = crabTops().find((s) => s.kind === 'window' && s.id === r.id && s.x2 - s.x1 > m * 2)
  if (top) placeFood(r.id, rand(top.x1 + m, top.x2 - m))
}

/** 走到食物旁邊：拿起來坐著吃。拿到就開始算冷卻，吃到一半不會又冒出一顆。 */
function startEating(food) {
  foods.splice(foods.indexOf(food), 1)
  lastAte = performance.now()
  crawl.eatT = 4
  crawl.sitT = 0
  actor.speed = 0 // 馬上停下來坐著吃，不要等慢慢減速
}

/** 黑熊在環上的一步：沿著可以走的那一段走，依目標決定方向。 */
function stepClimber(dt, e, path, onWindow) {
  const scale = config.scale
  const m = halfW() + 4
  const chain = climberChain(path, onWindow)
  let u = chainPos(path, chain, crawl.frac)
  const rect = onWindow ? loopShape(crawl.loop).rect : null

  let speed = (MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.pow(e, 1.2)) * speedFactor()
  if (crawl.boost > 0) {
    crawl.boost -= dt
    speed = Math.max(speed, 200)
  }
  let goal = null // 這一段上的目標位置（u）
  crawl.peek = false

  if (onWindow) {
    const food = foods.find((f) => f.id === crawl.loop.id)
    if (crawl.eatT > 0) {
      // 坐著抱著食物吃
      crawl.eatT -= dt
      speed = 0
      if (crawl.eatT <= 0) crawl.sitT = rand(5, 10)
    } else if (food && !crawl.leaving) {
      crawl.sitT = 0 // 站起來走過去，不是坐著滑過去
      const p = foodPos(food)
      if (p) {
        goal = chainPos(path, chain, fracAt(path, p.x, p.y))
        speed = Math.max(speed, MISSION_SPEED * scale * 0.7)
        if (Math.abs(goal - u) < 3) {
          startEating(food)
          goal = null
        }
      }
    } else if (crawl.sitT > 0) {
      crawl.sitT -= dt
      speed = 0
      if (crawl.sitT <= 0) crawl.leaving = true
    } else if (!crawl.leaving) {
      // 剛爬上來：走到頂端某個地方坐下來
      if (crawl.seatX === null) crawl.seatX = rand(rect.l + m, rect.r - m)
      goal = chainPos(path, chain, fracAt(path, crawl.seatX, rect.t))
      speed = Math.max(speed, MISSION_SPEED * scale * 0.6) // 有目的地時不要慢吞吞
      if (Math.abs(goal - u) < 3) {
        crawl.sitT = rand(6, 14) * (1 - 0.5 * e)
        actor.speed = 0 // 走到了就馬上坐下
        goal = null
      }
    }
    // 食物在別的地方（工具列上或別的視窗）：不坐了，下去找
    if (!food && foods.length && crawl.eatT <= 0 && !crawl.leaving) {
      crawl.leaving = true
      crawl.sitT = 0
    }
    if (crawl.leaving) {
      // 待夠了：從比較近、旁邊又有空間的那一側爬下來（貼著螢幕邊的那一側下去會跑出畫面）
      if (crawl.exitSide === null) {
        const room = halfW() * 2
        const leftOk = rect.l - room > cur.left
        const rightOk = rect.r + room < cur.right
        const nearLeft = u < chain.len / 2
        const left = leftOk === rightOk ? nearLeft : leftOk
        crawl.exitSide = left ? 0 : chain.len
      }
      goal = crawl.exitSide
      speed = Math.max(speed, MISSION_SPEED * scale * 0.6)
      if (Math.abs(goal - u) < 3) {
        climbDown(rect, goal === 0 ? -1 : 1)
        return
      }
    }
  } else {
    const limitY = cur.top + (groundY() - cur.top) * (1 - crawl.climbLimit)
    // 牆只爬到一半：換算成這一段上的範圍
    const pR = pointOnLoop(path, chainFrac(path, chain, 0))
    const uMin = clamp(limitY - pR.y, 0, chain.len)
    const uMax = chain.len - uMin
    const food = foods[0]
    let busy = false
    if (crawl.eatT > 0) {
      // 在工具列上坐著吃（食物從視窗掉下來的時候）
      busy = true
      crawl.eatT -= dt
      speed = 0
      if (crawl.eatT <= 0) crawl.sitT = rand(3, 6)
    } else if (crawl.sitT > 0) {
      busy = true
      crawl.sitT -= dt
      speed = 0
    } else if (food && food.id === null && food.landed) {
      // 食物掉在工具列上：直接走過去吃
      crawl.mission = null
      busy = true
      const p = foodPos(food)
      goal = chainPos(path, chain, fracAt(path, p.x, groundY()))
      speed = Math.max(speed, MISSION_SPEED * scale * 0.7)
      if (Math.abs(goal - u) < 3) {
        startEating(food)
        goal = null
      }
    } else if (food && food.id === null) {
      busy = true // 食物還在往下掉，等它落地
      speed = 0
    } else if (!crawl.mission && food) {
      const r = reachableWindows().find((w) => w.id === food.id)
      const side = r && climbSideOf(r)
      if (side) crawl.mission = { id: r.id, side: side.side, x: side.x }
    }
    if (crawl.mission && !busy) {
      const r = reachableWindows().find((w) => w.id === crawl.mission.id)
      if (!r) {
        crawl.mission = null
      } else {
        crawl.mission.x = crawl.mission.side < 0 ? r.l - m : r.r + m
        goal = chainPos(path, chain, fracAt(path, crawl.mission.x, groundY()))
        speed = Math.max(speed, MISSION_SPEED * scale)
        if (Math.abs(goal - u) < 3) {
          climbUp(r, crawl.mission.side)
          return
        }
      }
    }
    if (goal === null && !busy) {
      // 沒事做：走走停停，走到牆上就往上爬，爬到一半停下來東張西望再爬下來
      if (actor.pause > 0) {
        actor.pause -= dt
        speed = 0
        crawl.peek = crawlPose() === 'climb'
      } else {
        const idleChance = e < 0.25 ? 0.09 : e < 0.55 ? 0.02 : 0
        if (idleChance > 0 && Math.random() < idleChance * dt * 10) actor.pause = 0.6 + Math.random() * 2.2
        if (Math.random() < 0.06 * dt) crawl.move *= -1
      }
      if ((u <= uMin + 0.5 && crawl.move < 0) || (u >= uMax - 0.5 && crawl.move > 0)) {
        crawl.move *= -1
        actor.pause = rand(1.5, 3)
        crawl.climbLimit = rand(WALL_CLIMB[0], WALL_CLIMB[1])
      }
      if (config.perchWindows) {
        crawl.missionT -= dt
        if (crawl.missionT <= 0) {
          crawl.missionT = rand(8, 18) * (1 - 0.5 * e)
          const options = reachableWindows()
          const r = options[Math.floor(Math.random() * options.length)]
          const side = r && climbSideOf(r)
          if (side) crawl.mission = { id: r.id, side: side.side, x: side.x }
        }
      }
    }
    crawl.wallRange = [uMin, uMax]
  }

  if (goal !== null) {
    crawl.move = goal >= u ? 1 : -1
    speed = Math.min(speed, Math.abs(goal - u) / dt)
  }
  actor.speed += (speed - actor.speed) * Math.min(1, dt * 4)
  const step = actor.speed * dt
  let next = clamp(u + crawl.move * step, 0, chain.len)
  // 在螢幕上不爬過牆的一半（原本就在範圍外的話，只能往範圍裡走）
  if (!onWindow) next = clamp(next, Math.min(crawl.wallRange[0], u), Math.max(crawl.wallRange[1], u))
  u = next
  crawl.frac = chainFrac(path, chain, u)
  placeOnLoop(path, dt, step)
}

/** 依 crawl.frac 擺好位置、法線、角度與腳步（螃蟹和黑熊共用）。 */
function placeOnLoop(path, dt, step) {
  const pt = pointOnLoop(path, crawl.frac)
  actor.x = pt.x
  actor.lift = groundY() - pt.y
  crawl.nx = pt.nx
  crawl.ny = pt.ny
  // 攀爬型一直保持直立（在牆上是扒著牆，不是轉過去站在牆上）
  const target = mascotDef().climber ? 0 : angleOfNormal(pt.nx, pt.ny)
  crawl.angle = approachAngle(crawl.angle, target, dt * 10)
  // 前進方向投影到牠自己的左右，決定腳往哪邊擺、臉朝哪邊
  const along = (pt.tx * Math.cos(target) + pt.ty * Math.sin(target)) * crawl.move
  actor.dir = along >= 0 ? 1 : -1
  actor.phase += (step / (strideOf() * config.scale)) * Math.PI * 2 + dt * 1.1
  return pt
}

/** 從地上換到視窗的側邊，準備往上爬。 */
function climbUp(r, side) {
  const loop = { kind: 'window', id: r.id }
  const shape = loopShape(loop)
  if (!shape) return
  const path = loopSegments(shape)
  crawl.loop = loop
  crawl.frac = fracAt(path, side < 0 ? r.l : r.r, Math.min(r.b, groundY()) - 12)
  crawl.mission = null
  crawl.leaving = false
  crawl.seatX = null
  crawl.exitSide = null
  crawl.sitT = 0
  crawl.eatT = 0
  actor.pause = 0
  placeOnLoop(path, 0, 0) // 這一格就擺到新位置，不然會閃一下舊的
}

/** 從視窗側邊爬下來：搆得到地面就直接走回工具列上，太高就跳下去。 */
function climbDown(r, side) {
  const m = halfW() + 6
  crawl.leaving = false
  crawl.seatX = null
  crawl.exitSide = null
  if (groundY() - r.b <= topH() * REACH) {
    const shape = loopShape({ kind: 'screen' })
    const path = loopSegments(shape)
    crawl.loop = { kind: 'screen' }
    crawl.frac = fracAt(path, side < 0 ? r.l - m : r.r + m, groundY())
    crawl.move = side
    crawl.missionT = rand(8, 18)
    actor.pause = 0.5
    placeOnLoop(path, 0, 0)
  } else {
    crabFall(side * 90, 0)
  }
}

function stepCrabFree(dt, load) {
  const scale = config.scale
  const e = load / 100

  if (drag && drag.moved) {
    // 被抓著：轉正、腳亂蹬
    crawl.mode = 'held'
    crawl.mission = null
    crawl.angle = approachAngle(crawl.angle, 0, dt * 10)
    actor.speed = 0
    actor.phase += dt * 16
    return
  }

  if (crawl.mode !== 'walk') {
    stepCrabFall(dt)
    return
  }

  const shape = loopShape(crawl.loop)
  if (!shape) {
    // 爬著的視窗關掉、縮小或最大化了：掉下去
    crabFall(0, 0)
    return
  }
  const path = loopSegments(shape)
  const onWindow = crawl.loop.kind === 'window'

  // 爬著的地方被別的視窗蓋住了（例如使用者把另一個視窗拉到前面）：掉下去
  if (onWindow && coveredAt(crawl.loop.id, actor.x, feetY())) {
    crabFall(crawl.nx * 60, 0)
    return
  }

  if (mascotDef().climber) {
    stepClimber(dt, e, path, onWindow)
    return
  }

  // 速度跟工具列模式一樣：負載越高越快；有目的地時不會慢吞吞
  let speed = (MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.pow(e, 1.2)) * speedFactor()
  if (crawl.boost > 0) {
    crawl.boost -= dt
    speed = Math.max(speed, 260)
  }

  if (crawl.mission) {
    const target = crabTops().find((s) => s.id === crawl.mission.id && crawl.mission.lx >= s.x1 && crawl.mission.lx <= s.x2)
    if (!target || onWindow) {
      crawl.mission = null
    } else {
      speed = Math.max(speed, MISSION_SPEED * scale)
      const goal = fracAt(path, crawl.mission.lx, cur.top)
      const delta = ((goal - crawl.frac + 1.5) % 1) - 0.5
      crawl.move = delta >= 0 ? 1 : -1
      const remain = Math.abs(delta) * path.total
      if (remain < 3) {
        // 爬到視窗正上方的天花板了：放手跳下去
        crabFall(0, 0)
        return
      }
      speed = Math.min(speed, remain / dt)
    }
  }

  // 低負載時走走停停、偶爾自己轉向；有目的地時不停
  if (!crawl.mission && actor.pause > 0) {
    actor.pause -= dt
    speed = 0
  } else if (!crawl.mission) {
    const idleChance = e < 0.25 ? 0.09 : e < 0.55 ? 0.02 : 0
    if (idleChance > 0 && Math.random() < idleChance * dt * 10) actor.pause = 0.6 + Math.random() * 2.2
    if (Math.random() < 0.08 * dt) crawl.move *= -1
  }
  actor.speed += (speed - actor.speed) * Math.min(1, dt * 4)

  const step = actor.speed * dt
  crawl.frac = (crawl.frac + (crawl.move * step) / path.total + 1) % 1
  const pt = pointOnLoop(path, crawl.frac)
  actor.x = pt.x
  actor.lift = groundY() - pt.y
  crawl.nx = pt.nx
  crawl.ny = pt.ny

  const target = angleOfNormal(pt.nx, pt.ny)
  crawl.angle = approachAngle(crawl.angle, target, dt * 10)
  // 螃蟹橫著走：前進方向投影到牠自己的左右，決定腳往哪邊擺
  const along = (pt.tx * Math.cos(target) + pt.ty * Math.sin(target)) * crawl.move
  actor.dir = along >= 0 ? 1 : -1
  actor.phase += (step / (strideOf() * scale)) * Math.PI * 2 + dt * 1.1

  if (onWindow) {
    crawl.stayT -= dt
    if (crawl.stayT <= 0) crawl.leaving = true
    // 待夠了，爬到側邊或底部時往外跳下去
    if (crawl.leaving && (Math.abs(pt.nx) > 0.9 || pt.ny > 0.9)) {
      crabFall(pt.nx * 200 + pt.tx * crawl.move * 60, pt.ny * 120 - 120)
    }
  } else if (!crawl.mission && config.perchWindows) {
    crawl.missionT -= dt
    if (crawl.missionT <= 0) {
      crawl.missionT = rand(6, 16) * (1 - 0.5 * e)
      pickCrabMission()
    }
  }
}

function stepCrabFall(dt) {
  const m = halfW() + 4
  const x0 = actor.x
  const y0 = feetY()
  crawl.vy += GRAVITY * dt
  let x = x0 + crawl.vx * dt
  let y = y0 + crawl.vy * dt
  if (x < cur.left + m) { x = cur.left + m; crawl.vx = Math.abs(crawl.vx) * 0.4 }
  if (x > cur.right - m) { x = cur.right - m; crawl.vx = -Math.abs(crawl.vx) * 0.4 }
  if (y < cur.top + topH()) { y = cur.top + topH(); crawl.vy = Math.max(0, crawl.vy) }
  crawl.angle = approachAngle(crawl.angle, 0, dt * 9) // 在空中翻正
  actor.speed = 0
  actor.phase += dt * 16

  // 往下掉時，碰到的第一個上緣就落在那裡
  if (crawl.vy >= 0) {
    let hit = null
    for (const s of crabTops()) {
      if (y0 <= s.y + 0.5 && y >= s.y && x >= s.x1 && x <= s.x2 && (!hit || s.y < hit.y)) hit = s
    }
    if (!hit && y >= groundY()) hit = crabTops()[0]
    if (hit) {
      actor.x = x
      actor.lift = groundY() - hit.y
      if (crabLand(hit, x)) return
    }
  }
  actor.x = x
  actor.lift = groundY() - Math.min(y, groundY())
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

function birdFree() {
  return isFlyer() && roamFree()
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
  if (!mascotDef().bubbles) return
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
  if (isFlyer()) {
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

  // 只清掉上一格和這一格畫到的範圍（螃蟹在牆上或倒掛時身體會往旁邊或往下長；食物另外算）
  const boxes = [{ x: rx - 220 * scale, y: ry - 240 * scale, w: 440 * scale, h: 400 * scale }]
  const foodSpots = drawableFoods()
  for (const p of foodSpots) boxes.push({ x: p.x - 30 * scale, y: p.y - 40 * scale, w: 60 * scale, h: 46 * scale })
  if (lastBox) for (const b of lastBox) ctx.clearRect(b.x, b.y, b.w, b.h)
  else ctx.clearRect(0, 0, viewW, viewH)
  for (const b of boxes) ctx.clearRect(b.x, b.y, b.w, b.h)
  lastBox = boxes

  // 視窗頂端偷偷放的食物
  for (const p of foodSpots) {
    ctx.save()
    ctx.translate(p.x, p.y)
    mascotDef().food(ctx, { scale, time: now })
    ctx.restore()
  }

  ctx.save()
  ctx.translate(rx, ry)

  if (isFlyer()) {
    const flying = bird.mode === 'fly'
    const carried = !!(drag && drag.moved)
    mascotDef().draw(ctx, {
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

  if (crawlFree()) {
    // 繞著身體中心轉：貼在牆上、倒掛在天花板、在空中翻正
    const c = crabCenter()
    ctx.translate(c.x - rx, c.y - ry)
    ctx.rotate(crawl.angle)
    ctx.translate(0, topH() * 0.5)
  }

  if (bubbles.length && mascotDef().bubbles) drawBubbles(ctx, bubbles, scale)

  mascotDef().draw(ctx, {
    scale,
    load,
    pose: crawlPose(),
    wall: wallSide(),
    look: actor.look,
    lookY: actor.lookY,
    phase: actor.phase,
    speed: actor.speed,
    dir: actor.dir,
    heat: clamp((load - 55) / 45, 0, 1),
    blink: actor.blink,
    time: now,
  })
  ctx.restore()
}

/**
 * 爬行類現在的姿勢，給畫法參考（螃蟹不分）：
 * 'walk' 站在地上或視窗上 | 'climb' 貼在牆上或視窗側邊 | 'ceiling' 倒掛 | 'fall' 在空中 | 'held' 被抓著
 * | 'sit' 坐在視窗上 | 'eat' 坐著吃東西（攀爬型才有）| 'run' 負載高時在地上衝刺（有設定 run 的才有）
 */
function crawlPose() {
  if (drag && drag.moved) return 'held'
  if (!crawlFree()) return actor.lift > 0 ? 'fall' : groundPose()
  if (crawl.mode === 'held') return 'held'
  if (crawl.mode === 'fall') return 'fall'
  // 坐著、吃東西只在停下來時才畫，移動中一定是走路的姿勢
  const still = actor.speed < 5
  if (crawl.eatT > 0 && still) return 'eat'
  if (crawl.sitT > 0 && crawl.ny < -0.7 && still) return 'sit'
  if (crawl.ny > 0.7) return 'ceiling'
  if (Math.abs(crawl.nx) > 0.7) return 'climb'
  return groundPose()
}

/** 在地上（工具列、視窗頂端）時是走路還是衝刺；停下來時一樣站著。 */
function groundPose() {
  return actor.running && mascotDef().run && actor.speed > 5 ? 'run' : 'walk'
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
  let ax = actor.x
  let ly
  if (crawlFree()) {
    // 倒掛在天花板時標籤放在身體下面，其他時候放在身體上面
    const c = crabCenter()
    ax = c.x
    ly = crawl.ny > 0.5 ? c.y + topH() * 0.5 + 8 : Math.max(2, c.y - topH() * 0.5 - 26)
  } else {
    const birdHop = isFlyer() ? bird.hopY : 0
    ly = Math.max(2, feetY() - birdHop - topH() - 26)
  }
  const lx = Math.max(cur.left + 6, Math.min(cur.right - w - 6, ax - w / 2))
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
  if (crawlFree()) {
    const c = crabCenter()
    const r = Math.max(halfW(), topH() * 0.5) * 0.85
    return Math.abs(px - c.x) <= r && Math.abs(py - c.y) <= r
  }
  const feet = feetY() - (isFlyer() ? bird.hopY : 0)
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
    // 螃蟹可能倒掛或貼在牆上：被抓起來時轉正，讓游標抓在身體中間
    dx: crawlFree() ? 0 : e.clientX - actor.x,
    dy: crawlFree() ? -topH() * 0.5 : e.clientY - feetY(),
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
      if (isFlyer()) bird.hopY = 0
      if (crawlFree()) {
        crawl.mode = 'held'
        crawl.nx = 0
        crawl.ny = -1
      }
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
  if (crawlFree()) {
    // 放開就往下掉，落在第一個碰到的視窗頂端或工具列上
    crabFall(0, 0)
    if (expanded) window.crabAPI.dropOnDisplay(cur.id)
  } else if (isFlyer()) {
    if (actor.lift <= 0) {
      actor.lift = 0
      landOn(groundPerch(), actor.x)
      if (expanded) window.crabAPI.dropOnDisplay(cur.id)
    } else {
      bird.mode = 'fly'
      bird.target = null
      bird.flightT = 0
      bird.route = config.roamScreen ? 1 : 0
      // 到處飛的時候整台螢幕都是範圍，放開就可以把視窗縮回這台螢幕
      if (expanded && config.roamScreen) window.crabAPI.dropOnDisplay(cur.id)
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
  if (isFlyer()) {
    // 被戳到會嚇一跳飛走
    takeOff(e.clientX)
    return
  }
  if (crawlFree()) {
    crawl.move *= -1
    crawl.mission = null
    crawl.boost = 1.2
    actor.pause = 0
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
  const wasFlyer = isFlyer()
  config = { ...config, ...data }
  // 吉祥物被隱藏時主程序已經把穿透設回去了，這邊的狀態要跟著重置
  if (config.showCrab === false) {
    hovering = false
    document.body.classList.remove('hot')
  }
  // 從螃蟹換成小鳥：從地上開始
  if (isFlyer() && !wasFlyer) {
    actor.lift = 0
    landOn(groundPerch(), actor.x)
  }
  resize()
})
window.crabAPI.onLayout(applyLayout)
window.crabAPI.onPerches((data) => {
  perchesScreen = Array.isArray(data && data.perches) ? data.perches : []
  windowsScreen = Array.isArray(data && data.windows) ? data.windows : []
  trackWindowStillness()
})
window.crabAPI.getLayout().then((l) => { if (l) applyLayout(l) }).catch(() => {})
window.crabAPI.getConfig().then((c) => {
  config = { ...config, ...c }
  if (isFlyer()) landOn(groundPerch(), actor.x)
}).catch(() => {})

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

resize()
requestAnimationFrame(frame)
