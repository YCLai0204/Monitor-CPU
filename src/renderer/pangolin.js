'use strict'

/**
 * 台灣穿山甲（Q 版、側面）：全身一片片重疊的褐色鱗片、粉膚色的尖嘴小臉、粗粗的長尾巴、前腳的大爪子。
 * 跟其他吉祥物一樣是用 Canvas 即時畫出來的，沒有圖檔。
 *
 * 座標原點放在「腳底中心」，往上是負的；預設面向右邊，dir = -1 時左右翻過來。
 * 動作用的是黑熊那一套攀爬型爬行（app.js 的 'crawl' + climber），這支只依 pose 畫出姿勢：
 *   'walk'   四腳走路：前腳的大爪子往後收在腳掌下面，尾巴拖在後面
 *   'climb'  扒在牆上或視窗側邊：整隻轉成直的，四隻腳抓著 wall（1 右、-1 左）那一側；lookY > 0（往下爬）時頭朝下
 *   'sit'    趴在視窗頂端休息：腳收起來
 *   'eat'    低頭伸長舌頭舔面前的白蟻窩
 *   'curl'   被戳到時捲成一顆球，過一下才打開
 *   'held' / 'fall'  被抓起來、在空中：一樣捲成球（真的穿山甲遇到危險就是這樣）
 *   'run'    負載高時捲成球在地上滾（Q 版的誇張，真的穿山甲是用走的）
 *   'icon'   圖示用的站姿
 *
 * drawFood 畫的是偷偷放在視窗頂端的食物：一座小小的白蟻窩，旁邊爬著幾隻白蟻。
 *
 * 包在 IIFE 裡的理由同 crab.js：幾支 <script> 共用全域範圍，避免同名變數衝突。
 */
;(function () {
const C = {
  scale: '#9a6634',
  scaleHi: '#c99459',
  scaleEdge: '#5e3a17',
  scaleDark: '#7a4d24',   // 遠的那一側的腳
  outline: '#3f250d',
  skin: '#efc3b1',
  skinDark: '#cf9a86',
  pad: '#b9806c',
  nose: '#6b3f37',
  eye: '#1d1310',
  claw: '#f3e6d0',
  blush: 'rgba(255, 110, 120, 0.7)',
  tongue: '#ec8a96',
}

const BALL_POSES = ['curl', 'held', 'fall', 'run'] // 這些姿勢是一顆球，要跟 app.js 一致
const BALL_R = 17   // 捲成球時的半徑（身體加尾巴的長度剛好繞一圈）
const STRIDE = 30   // 要跟 app.js MASCOT_DEFS 的 stride 一致：滾的時候轉的角度才會跟移動距離對上
const WALL_X = 25   // 牆的位置（離腳底中心的水平距離），要跟 app.js 的 CLIMB_GAP 一致
const BODY_MID = 20 // 身體中段的高度（MASCOT_DEFS 的 top 的一半），扒牆時繞這裡轉

function drawPangolin(ctx, opts) {
  const {
    scale = 1,
    phase = 0,
    speed = 0,
    dir = 1,
    lookY = 0,
    wall = 0,
    pose = 'walk',
    heat = 0,
    blink = 0,
    detail = 'high',
    shadow = true,
    time = 0,
  } = opts

  const low = detail === 'low'
  // 捲到幾成：app.js 會給（捲起來、打開時慢慢變）；沒給的話（圖示、預覽）看姿勢直接決定
  const k = opts.curl ?? (BALL_POSES.includes(pose) ? 1 : 0)

  ctx.save()
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (k > 0 && k < 1) {
    drawCurling(ctx, { k, dir, blink, heat, low, time, shadow })
    ctx.restore()
    return
  }

  if (k >= 1) {
    const rolling = pose === 'run'
    if (shadow && pose !== 'held' && pose !== 'fall') drawShadow(ctx, BALL_R + 2)
    ctx.scale(dir < 0 ? -1 : 1, 1)
    if (rolling && !low) drawDust(ctx, speed, time)
    // 滾的時候轉的角度 = 移動距離 / 半徑（往右滾是順時針，左右翻過來後剛好變逆時針）
    const roll = rolling ? (phase * STRIDE) / (Math.PI * 2 * BALL_R) : 0
    drawBall(ctx, roll, low, pose === 'held' ? Math.sin(time * 0.02) : 0)
    ctx.restore()
    return
  }

  if (pose === 'climb' && wall) {
    // 扒著牆：整隻轉成直的、腳底貼著牆。面向右邊的畫法轉過去後，牆在右邊時頭朝上、在左邊時頭朝下，
    // 要反過來的時候（往下爬、或牆在左邊往上爬）先左右翻過來
    const down = lookY > 0.3
    ctx.translate(wall * WALL_X, -BODY_MID)
    ctx.rotate((-wall * Math.PI) / 2)
    ctx.scale((wall < 0) !== down ? -1 : 1, 1)
    drawSide(ctx, { pose, phase, speed, heat, blink, low, time })
    ctx.restore()
    return
  }

  if (shadow && pose !== 'climb') drawShadow(ctx, 30)
  ctx.scale(dir < 0 ? -1 : 1, 1)
  drawSide(ctx, { pose, phase, speed, heat, blink, low, time })
  if (heat > 0.35 && !low && pose !== 'icon') drawSweat(ctx, heat, time)
  ctx.restore()
}

function drawShadow(ctx, rx) {
  ctx.save()
  ctx.globalAlpha = 0.22
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.ellipse(0, 1, rx, 3.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// ---------------------------------------------------------------- 側面（走路、扒牆、趴著、吃東西）

/** 側面的整隻穿山甲，面向右邊。tuck（0..1）是腳收進肚子底下收到幾成（捲成球的第一步）。 */
function drawSide(ctx, { pose, phase, speed, heat, blink, low, time, tuck = 0 }) {
  const walking = pose === 'walk' || pose === 'climb'
  const resting = pose === 'sit'
  const eating = pose === 'eat'
  // 腳步幅度跟著速度平滑變大變小，停下來時慢慢收回
  const stride = walking ? Math.min(1, speed / 30) : 0
  const bob = walking ? -Math.abs(Math.sin(phase)) * 1.2 * stride : 0

  // 遠的那一側的腳先畫，會被身體擋住一部分
  if (!resting) {
    drawLeg(ctx, 15, phase + Math.PI, stride, true, false, low, tuck)
    drawLeg(ctx, -11, phase, stride, false, false, low, tuck)
  }

  // 頭先畫，脖子被身體前緣的鱗片蓋住，看起來才像從鱗甲裡伸出來。
  // 吃東西時蟻丘不在這裡畫：app.js 讓穿山甲停在蟻丘旁邊（腳底中心前面 58，MASCOT_DEFS 的 foodReach），
  // 蟻丘留在原地照常畫，才不會跳一下；低頭伸出的舌頭剛好舔到那裡
  ctx.save()
  ctx.translate(0, bob + (resting ? 5 : 0))
  drawHead(ctx, { blink: resting ? Math.max(blink, 0.55) : blink, heat, low, eating, time })
  drawBody(ctx, low)
  ctx.restore()

  if (resting) {
    // 腳收在肚子下面，只露出一點腳掌
    for (const x of [-12, 14]) {
      ctx.beginPath()
      ctx.ellipse(x, -1.8, 4.6, 2.2, 0, 0, Math.PI * 2)
      ctx.fillStyle = C.pad
      ctx.fill()
    }
  } else {
    drawLeg(ctx, 13, phase, stride, true, true, low, tuck)
    drawLeg(ctx, -13, phase + Math.PI, stride, false, true, low, tuck)
  }
}

/** 身體加尾巴：同一個方向畫的兩段路徑，合起來填色時才不會在交界挖出一個洞。 */
function bodyPath(ctx) {
  ctx.beginPath()
  // 身體：從屁股下緣往上繞過背，到胸前，再沿著肚子回來
  ctx.moveTo(-24, -8)
  ctx.bezierCurveTo(-30, -22, -16, -38, 4, -37)
  ctx.bezierCurveTo(18, -36, 27, -28, 27, -18)
  ctx.bezierCurveTo(27, -10, 20, -6, 12, -6)
  ctx.lineTo(-16, -6)
  ctx.quadraticCurveTo(-23, -6, -24, -8)
  ctx.closePath()
  // 尾巴：粗粗的、越後面越細，尾巴尖碰到地上
  ctx.moveTo(-20, -7)
  ctx.bezierCurveTo(-32, -6, -44, -4, -52, -0.5)
  ctx.quadraticCurveTo(-56.5, -0.5, -55, -4)
  ctx.bezierCurveTo(-47, -17, -34, -28, -16, -33)
  ctx.closePath()
}

function drawBody(ctx, low) {
  // 先用粗線描一圈再填色，外框只剩外面那一半，身體和尾巴的交界就不會有線
  bodyPath(ctx)
  ctx.lineWidth = low ? 5 : 3.2
  ctx.strokeStyle = C.outline
  ctx.stroke()
  ctx.fillStyle = C.scale
  ctx.fill()

  // 鱗片：從尾巴往頭一排排畫，靠頭那一片蓋住後面那一片的根部，露出來的圓邊都朝著尾巴
  ctx.save()
  bodyPath(ctx)
  ctx.clip()
  const s = low ? 6 : 4.4
  const dx = low ? 9 : 6.2
  const dy = low ? 7.5 : 5.2
  let row = 0
  for (let y = -40; y <= 0; y += dy, row++) {
    for (let x = -60 + (row % 2) * dx * 0.5; x <= 32; x += dx) drawScale(ctx, x, y, s, Math.PI, low)
  }
  ctx.restore()
}

/** 一片鱗片：圓邊（沒被蓋住的那一邊）朝 angle 的方向，平的那一邊會被下一片蓋住。 */
function drawScale(ctx, x, y, s, angle, low) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(-s * 0.9, -s * 0.85)
  ctx.quadraticCurveTo(s * 1.1, -s * 0.95, s * 1.05, 0)
  ctx.quadraticCurveTo(s * 1.1, s * 0.95, -s * 0.9, s * 0.85)
  ctx.closePath()
  ctx.fillStyle = C.scale
  ctx.fill()
  ctx.lineWidth = low ? 1.4 : 0.9
  ctx.strokeStyle = C.scaleEdge
  ctx.stroke()
  if (!low) {
    // 每片中間一道亮一點的光，看起來才有一片片的立體感
    ctx.beginPath()
    ctx.moveTo(-s * 0.3, -s * 0.4)
    ctx.quadraticCurveTo(s * 0.5, -s * 0.5, s * 0.65, -s * 0.05)
    ctx.lineWidth = 0.9
    ctx.strokeStyle = C.scaleHi
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * 一隻腳。x 是腳跟身體接起來的位置，front 是前腳，near 是靠近我們這一側（顏色亮一點）。
 * 前腳的大爪子往後收在腳掌下面（穿山甲用指背走路，爪子才不會磨鈍），後腳的短爪朝前。
 * tuck（0..1）是收進肚子底下收到幾成：整隻腳往上縮，腳掌跟著變小。
 */
function drawLeg(ctx, x, ph, stride, front, near, low, tuck = 0) {
  if (tuck >= 0.98) return
  const fx = x + Math.sin(ph) * 6 * stride
  const fy = -Math.max(0, Math.cos(ph)) * 3 * stride - tuck * 9
  const col = near ? C.scale : C.scaleDark
  ctx.beginPath()
  ctx.moveTo(x, -12)
  ctx.lineTo(fx, fy - 3)
  ctx.lineWidth = (low ? 9 : 7.5) + 2
  ctx.strokeStyle = C.outline
  ctx.stroke()
  ctx.lineWidth = low ? 9 : 7.5
  ctx.strokeStyle = col
  ctx.stroke()

  // 腳掌和爪子：原點移到腳底，收腳時以這裡為中心縮小
  ctx.save()
  ctx.translate(fx, fy)
  ctx.scale(1 - tuck, 1 - tuck)
  ctx.beginPath()
  ctx.ellipse(front ? 0.5 : 1.5, -2.2, front ? 4 : 4.8, 2.6, 0, 0, Math.PI * 2)
  ctx.fillStyle = near ? C.skinDark : C.pad
  ctx.fill()
  if (!low) {
    ctx.lineWidth = 1.3
    ctx.strokeStyle = C.claw
    if (front) {
      for (const k of [0, 1.6]) {
        ctx.beginPath()
        ctx.moveTo(3.2 - k, -3.4)
        ctx.quadraticCurveTo(6 - k, -0.6, 1.5 - k, -0.2)
        ctx.stroke()
      }
    } else {
      for (const k of [-0.9, 0.9]) {
        ctx.beginPath()
        ctx.moveTo(5.4, -2 + k)
        ctx.lineTo(7.6, -1.2 + k * 0.8)
        ctx.stroke()
      }
    }
  }
  ctx.restore()
}

/** 頭的外形（尖尖的長嘴往前伸），不含跟身體接起來的那一邊。 */
function headOutline(ctx) {
  ctx.moveTo(18, -30)
  ctx.bezierCurveTo(28, -34, 38, -29, 44, -20)
  ctx.quadraticCurveTo(50, -13, 49.5, -11)
  ctx.quadraticCurveTo(48.5, -8.5, 45, -9.5)
  ctx.bezierCurveTo(38, -10, 30, -8, 22, -9)
}

const NECK = { x: 22, y: -18 } // 低頭時繞這裡轉
const EAT_TILT = 0.3

function drawHead(ctx, { blink, heat, low, eating, time }) {
  ctx.save()
  if (eating) {
    ctx.translate(NECK.x, NECK.y)
    ctx.rotate(EAT_TILT)
    ctx.translate(-NECK.x, -NECK.y)
  }

  if (eating) {
    // 長舌頭一伸一縮，伸進白蟻窩裡（先畫，嘴巴會蓋住舌根）
    const t = 0.5 + 0.5 * Math.sin(time * 0.012)
    const len = 4 + t * 9
    ctx.beginPath()
    ctx.moveTo(47, -10)
    ctx.quadraticCurveTo(47 + len * 0.6, -9.5, 47 + len, -8 + len * 0.1)
    ctx.lineWidth = low ? 2.4 : 1.8
    ctx.strokeStyle = C.tongue
    ctx.stroke()
  }

  ctx.beginPath()
  headOutline(ctx)
  ctx.closePath()
  ctx.fillStyle = C.skin
  ctx.fill()

  // 頭頂到額頭也是鱗片
  ctx.save()
  ctx.beginPath()
  headOutline(ctx)
  ctx.closePath()
  ctx.clip()
  const s = low ? 4.6 : 3.6
  for (const [x, y] of [[19, -28], [24, -31], [29, -31.5], [33.5, -30]]) drawScale(ctx, x, y, s, Math.PI * 0.95, low)
  ctx.restore()

  ctx.beginPath()
  headOutline(ctx)
  ctx.lineWidth = low ? 2.5 : 1.6
  ctx.strokeStyle = C.outline
  ctx.stroke()

  if (!low) {
    // 小小的耳朵（穿山甲的耳朵只是一小片）
    ctx.beginPath()
    ctx.arc(25.5, -20, 2.3, Math.PI * 0.6, Math.PI * 1.7)
    ctx.lineWidth = 1.2
    ctx.strokeStyle = C.skinDark
    ctx.stroke()
  }

  // 鼻頭
  ctx.beginPath()
  ctx.ellipse(48.6, -11.2, low ? 1.8 : 1.4, low ? 1.6 : 1.2, 0, 0, Math.PI * 2)
  ctx.fillStyle = C.nose
  ctx.fill()

  // 眼睛（Q 版大一點，加一點反光）
  const ex = 34.5
  const ey = -21
  const er = low ? 3.2 : 2.6
  if (blink < 0.6) {
    ctx.beginPath()
    ctx.ellipse(ex, ey, er, er * (1 - blink), 0, 0, Math.PI * 2)
    ctx.fillStyle = C.eye
    ctx.fill()
    if (!low) {
      ctx.beginPath()
      ctx.arc(ex + 0.9, ey - 1, 0.85, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
    }
  } else {
    // 閉著眼：一條往下彎的線
    ctx.beginPath()
    ctx.moveTo(ex - er, ey)
    ctx.quadraticCurveTo(ex, ey + er * 0.8, ex + er, ey)
    ctx.lineWidth = low ? 1.8 : 1.3
    ctx.strokeStyle = C.eye
    ctx.stroke()
  }

  // 負載高時臉紅
  if (heat > 0 && !low) {
    ctx.beginPath()
    ctx.ellipse(37.5, -15, 3.2, 1.9, 0, 0, Math.PI * 2)
    ctx.globalAlpha = heat
    ctx.fillStyle = C.blush
    ctx.fill()
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

function drawSweat(ctx, heat, time) {
  ctx.save()
  const n = heat > 0.7 ? 2 : 1
  for (let i = 0; i < n; i++) {
    const t = (time * 0.0012 + i * 0.5) % 1
    const x = i === 0 ? 40 + t * 3 : 10 - t * 3
    const y = -40 + t * 12
    ctx.globalAlpha = Math.min(1, (1 - t) * 1.6) * Math.min(1, (heat - 0.35) * 3)
    ctx.beginPath()
    ctx.moveTo(x, y - 5)
    ctx.quadraticCurveTo(x + 3.4, y + 0.5, x, y + 2.6)
    ctx.quadraticCurveTo(x - 3.4, y + 0.5, x, y - 5)
    ctx.fillStyle = '#8fd3ff'
    ctx.fill()
    ctx.lineWidth = 0.9
    ctx.strokeStyle = '#3c7fb0'
    ctx.stroke()
  }
  ctx.restore()
}

// ---------------------------------------------------------------- 捲起來的過程

/** 側面輪廓的上緣（尾巴、背、頭頂）[x, y]，捲起來時每一條都以這裡對齊到圓上。 */
const TOP_EDGE = [
  [-58, -1], [-50, -6], [-40, -14], [-30, -23], [-20, -31], [-10, -36], [0, -37.5],
  [10, -37], [18, -34], [24, -31], [30, -31], [36, -29], [42, -23], [47, -16], [51, -10], [54, -6],
]

function topAt(x) {
  if (x <= TOP_EDGE[0][0]) return TOP_EDGE[0][1]
  for (let i = 1; i < TOP_EDGE.length; i++) {
    const [x1, y1] = TOP_EDGE[i]
    if (x <= x1) {
      const [x0, y0] = TOP_EDGE[i - 1]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return TOP_EDGE[TOP_EDGE.length - 1][1]
}

const SIDE_BOX = { x0: -60, x1: 56, y0: -42, y1: 4 } // 側面整隻（腳收起來時）的範圍
const BEND_X = -3     // 身體中段：彎的時候不動的那一點
const BEND_Y = -37.5  // 背最高的地方
const STRIP = 2.5     // 切成多寬的直條
let curlCanvas = null

/**
 * 捲起來（k 從 0 到 1）或打開（從 1 到 0）的中間畫面：
 *   1. 先把腳收進肚子底下
 *   2. 身體從中段開始往肚子那一側彎，頭和尾巴往下捲到肚子底下，背在外面；
 *      彎到底時背剛好繞成半徑 BALL_R 的一圈（身體加尾巴的長度剛好是圓周長）
 *   3. 最後一段完整的球從中間長出來蓋上去，接到捲好的樣子
 * 做法是把側面畫到暫存畫布，切成直條，每一條沿著越來越彎的弧排好、轉到垂直於弧的方向。
 * 尾巴那一側最後畫，蓋在頭上面（真的穿山甲是用尾巴把頭包住）。
 */
function drawCurling(ctx, { k, dir, blink, heat, low, time, shadow }) {
  const e = k * k * (3 - 2 * k) // 頭尾慢、中間快
  const tuck = Math.min(1, e * 3)
  const bend = Math.max(0, Math.min(1, (e - 0.12) / 0.88))
  if (shadow) drawShadow(ctx, 30 + (BALL_R + 2 - 30) * e)
  ctx.scale(dir < 0 ? -1 : 1, 1)

  // 暫存畫布的解析度跟著目前的縮放（含螢幕 DPI），放大也不會糊
  const m = ctx.getTransform()
  const px = Math.max(1, Math.hypot(m.a, m.b))
  const B = SIDE_BOX
  const w = Math.ceil((B.x1 - B.x0) * px)
  const h = Math.ceil((B.y1 - B.y0) * px)
  if (!curlCanvas) curlCanvas = document.createElement('canvas')
  if (curlCanvas.width !== w || curlCanvas.height !== h) {
    curlCanvas.width = w
    curlCanvas.height = h
  }
  const o = curlCanvas.getContext('2d')
  o.setTransform(1, 0, 0, 1, 0, 0)
  o.clearRect(0, 0, w, h)
  o.setTransform(px, 0, 0, px, -B.x0 * px, -B.y0 * px)
  o.lineJoin = 'round'
  o.lineCap = 'round'
  drawSide(o, { pose: 'walk', phase: 0, speed: 0, heat, blink: Math.max(blink, bend), low, time, tuck })

  const R = BALL_R
  if (bend <= 0) {
    // 還在收腳：整張直接貼回去就好
    ctx.drawImage(curlCanvas, B.x0, B.y0, w / px, h / px)
    return
  }
  // 彎的中心點從背上慢慢移到球的頂端（球心在原點正上方 R）
  const ax = BEND_X * (1 - bend)
  const ay = BEND_Y + (-2 * R - BEND_Y) * bend
  // 捲起來時身體往背那一側擠，肚子那一側才不會從圓的另一邊穿出去
  const squash = 1 - 0.45 * bend
  if (bend > 0.5) {
    // 快捲好時圈圈中間還沒填滿會透出背景：先在圓心墊一塊深色，像看進捲起來的身體裡（不超出地面）
    const cy = ay + R / bend
    ctx.save()
    ctx.globalAlpha = Math.min(1, (bend - 0.5) * 4)
    ctx.beginPath()
    ctx.arc(ax, cy, Math.max(0, Math.min(R * 0.85, -cy)), 0, Math.PI * 2)
    ctx.fillStyle = C.scaleDark
    ctx.fill()
    ctx.restore()
  }
  for (let x = B.x1 - STRIP; x >= B.x0 - 0.01; x -= STRIP) {
    const cx = x + STRIP / 2
    const top = topAt(cx)
    const s = cx - BEND_X
    const phi = (s * bend) / R
    const r = R / bend
    const sh = B.y1 - top
    ctx.save()
    ctx.translate(ax + r * Math.sin(phi), ay + r * (1 - Math.cos(phi)))
    ctx.rotate(phi)
    // 背的高低差：沒彎的時候照原本的輪廓，彎到底時每一條的背都對齊在圓上
    ctx.translate(0, (top - BEND_Y) * (1 - bend))
    // 每一條往右多取一點、蓋住下一條，接縫才不會透光；來源和目的寬度一樣，斜的輪廓才不會變成鋸齒
    const sw = Math.min(STRIP + 0.8, B.x1 - x)
    ctx.drawImage(curlCanvas, (x - B.x0) * px, (top - B.y0) * px, sw * px, sh * px, -STRIP / 2, 0, sw, sh * squash)
    ctx.restore()
  }

  // 最後一段淡入完整的球，接到捲好的樣子
  const g = Math.max(0, (e - 0.7) / 0.3)
  if (g > 0) {
    ctx.save()
    ctx.globalAlpha = g
    drawBall(ctx, 0, low, 0)
    ctx.restore()
  }
}

// ---------------------------------------------------------------- 捲成球

/**
 * 捲成一顆球：鱗片一圈圈朝外，尾巴包在最外面捲成一道螺旋。球心在原點正上方 BALL_R。
 * roll 是滾動的角度；wiggle（-1..1）不是 0 時尾巴尖從縫裡露出來晃（被抓著的時候）。
 */
function drawBall(ctx, roll, low, wiggle) {
  const R = BALL_R
  ctx.save()
  ctx.translate(0, -R)
  ctx.rotate(roll)

  ctx.beginPath()
  ctx.arc(0, 0, R, 0, Math.PI * 2)
  ctx.lineWidth = low ? 5 : 3.2
  ctx.strokeStyle = C.outline
  ctx.stroke()
  ctx.fillStyle = C.scale
  ctx.fill()

  // 鱗片：外圈先畫、內圈蓋上去，露出來的圓邊都朝外
  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, R, 0, Math.PI * 2)
  ctx.clip()
  const rings = low ? [[R - 4, 9, 5.6], [R - 12, 4, 4.6]] : [[R - 3.2, 13, 4.4], [R - 9.5, 8, 3.8], [R - 15, 3, 3.2]]
  rings.forEach(([r, n, size], k) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + k * 0.4
      drawScale(ctx, Math.cos(a) * r, Math.sin(a) * r, size, a, low)
    }
  })
  ctx.restore()

  // 尾巴包在外面：一道從外往內捲的螺旋
  ctx.beginPath()
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    const a = -Math.PI * 0.55 + t * Math.PI * 1.5
    const r = R - 1 - t * 8
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.lineWidth = low ? 2.2 : 1.6
  ctx.strokeStyle = C.outline
  ctx.stroke()

  if (wiggle && !low) {
    // 尾巴尖從縫裡露出來亂晃
    const a = -Math.PI * 0.55
    const bx = Math.cos(a) * (R - 1)
    const by = Math.sin(a) * (R - 1)
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.quadraticCurveTo(bx - 6, by - 4 + wiggle * 3, bx - 9, by + wiggle * 4)
    ctx.lineWidth = 4
    ctx.strokeStyle = C.outline
    ctx.stroke()
    ctx.lineWidth = 2.4
    ctx.strokeStyle = C.scale
    ctx.stroke()
  }
  ctx.restore()
}

/** 滾的時候後面揚起的塵土（已經左右翻好了，後面就是 -x）。 */
function drawDust(ctx, speed, time) {
  ctx.save()
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.003 + i / 3) % 1
    ctx.globalAlpha = (1 - t) * 0.45 * Math.min(1, speed / 120)
    ctx.fillStyle = '#d9cdb8'
    ctx.beginPath()
    ctx.arc(-18 - t * 22, -3 - t * 7, 2.5 + t * 4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

// ---------------------------------------------------------------- 食物

const FOOD = {
  mound: '#b98a5c',
  moundHi: '#d6a877',
  moundDark: '#7d5634',
  hole: '#4a3020',
  ant: '#3a2418',
}

/** 白蟻窩：一座小土丘，上面有幾個洞。原點是土丘底部中心。 */
function drawMound(ctx, x, y, low, time) {
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  ctx.moveTo(-10, 0)
  ctx.bezierCurveTo(-9, -8, -4, -14, 0, -14)
  ctx.bezierCurveTo(4, -14, 9, -8, 10, 0)
  ctx.closePath()
  ctx.fillStyle = FOOD.mound
  ctx.fill()
  ctx.lineWidth = low ? 1.6 : 1.1
  ctx.strokeStyle = FOOD.moundDark
  ctx.stroke()
  if (!low) {
    ctx.beginPath()
    ctx.moveTo(-5, -9)
    ctx.quadraticCurveTo(-3, -12.5, 0.5, -12.5)
    ctx.lineWidth = 1.2
    ctx.strokeStyle = FOOD.moundHi
    ctx.stroke()
  }
  ctx.fillStyle = FOOD.hole
  for (const [hx, hy, r] of [[-3.5, -4, 1.6], [3, -7, 1.3], [1, -2.5, 1.1]]) {
    ctx.beginPath()
    ctx.ellipse(hx, hy, r, r * 0.8, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // 白蟻沿著土丘爬上爬下
  if (!low) {
    for (let i = 0; i < 3; i++) {
      const t = (time * 0.00035 + i / 3) % 1
      const s = Math.sin(t * Math.PI * 2)
      const ax = -12 + t * 24
      const ay = Math.abs(ax) < 10 ? -(1 - (ax / 10) ** 2) * 13 - 0.8 : -0.8
      ctx.fillStyle = FOOD.ant
      ctx.beginPath()
      ctx.arc(ax - 0.9, ay + s * 0.2, 0.75, 0, Math.PI * 2)
      ctx.arc(ax + 0.6, ay, 0.95, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** 偷偷放在視窗頂端的食物：一座白蟻窩，原點是放在視窗頂端的位置，偶爾閃一下。 */
function drawFood(ctx, { scale = 1, time = 0 } = {}) {
  ctx.save()
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  drawMound(ctx, 0, 0, false, time)
  // 閃一下，讓人注意到「好像多了什麼」
  const t = (time * 0.0006) % 1
  if (t < 0.25) {
    ctx.globalAlpha = Math.sin((t / 0.25) * Math.PI)
    ctx.fillStyle = '#fff6c8'
    ctx.beginPath()
    const sx = 10
    const sy = -18
    ctx.moveTo(sx, sy - 4)
    ctx.lineTo(sx + 1, sy - 1)
    ctx.lineTo(sx + 4, sy)
    ctx.lineTo(sx + 1, sy + 1)
    ctx.lineTo(sx, sy + 4)
    ctx.lineTo(sx - 1, sy + 1)
    ctx.lineTo(sx - 4, sy)
    ctx.lineTo(sx - 1, sy - 1)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

// ---------------------------------------------------------------- 圖示

/** 圖示用的外框（腳底為原點），站姿固定，直接寫死就好。小圖示只取頭和身體前半，整隻縮下去會看不清楚。 */
const ICON_BOUNDS = { left: -58, right: 52, top: -40, bottom: 2 }
const ICON_BUST = { left: 4, right: 52, top: -40, bottom: 2 }

/** 把站著的穿山甲畫成 size×size 的 PNG data URL；32px 以下用粗線條、省略細節、只畫前半身。 */
function renderIcon(size, detail = size <= 32 ? 'low' : 'high') {
  const b = size <= 32 ? ICON_BUST : ICON_BOUNDS
  const pad = size <= 32 ? 0 : size * 0.04
  const s = (size - pad * 2) / Math.max(b.right - b.left, b.bottom - b.top)
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  ctx.translate(size / 2 - ((b.left + b.right) / 2) * s, size / 2 - ((b.top + b.bottom) / 2) * s)
  drawPangolin(ctx, { scale: s, pose: 'icon', detail, shadow: false })
  return c.toDataURL('image/png')
}

window.MascotArt = Object.assign(window.MascotArt || {}, { pangolin: { draw: drawPangolin, drawFood, renderIcon } })
})()
