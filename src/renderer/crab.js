'use strict'

/**
 * 螃蟹是用 Canvas 即時畫出來的，沒有任何圖檔或動畫序列。
 * 好處是顏色可以隨著負載連續變化（青色 → 紅色），腳的擺動頻率
 * 也能直接綁在移動速度上，跑越快腳就踏越急。
 *
 * 座標原點放在螃蟹的「腳底中心」，往上是負的。預設面向觀眾，
 * 靠橫向平移來走路（螃蟹本來就是橫著走）。
 *
 * exe 圖示和系統匣圖示也是用這份畫法產生的（見 renderIcon），
 * 所以改了這裡的長相，圖示會跟著一起變。
 *
 * 這裡包在 IIFE 裡：兩支 <script> 共用同一個全域範圍，不包起來的話
 * 這邊的 drawCrab 會跟 app.js 解構出來的同名變數撞在一起。
 */
;(function () {
const LEGS_PER_SIDE = 4

function palette(hue) {
  return {
    base: `hsl(${hue}, 72%, 52%)`,
    dark: `hsl(${hue}, 68%, 34%)`,
    deep: `hsl(${hue}, 70%, 24%)`,
    light: `hsl(${hue}, 85%, 68%)`,
    glow: `hsl(${hue}, 90%, 60%)`,
  }
}

/** 0% 青色 → 100% 紅色 */
function loadToHue(load) {
  const t = Math.max(0, Math.min(1, load / 100))
  return 186 - 186 * t
}

function drawCrab(ctx, opts) {
  const {
    scale = 1,
    hue = 186,
    phase = 0,
    speed = 0,
    dir = 1,
    heat = 0,        // 0..1，越高越「燙」，會加上光暈與蒸氣
    blink = 0,       // 0..1，1 = 完全閉眼
    time = 0,
    pose = 'walk',   // 'icon'：左右對稱、完全靜止的站姿
    detail = 'high', // 'low'：線條加粗、省略殼紋與嘴，給 16–32px 的小圖示用
    shadow = true,
    lostClaw = 0,    // 被甩掉的那隻螯（-1 左、1 右、0 都在）
    regrow = 0,      // 掉的那隻長回來長到幾成（0..1），螃蟹的螯真的會再生
  } = opts

  const st = { still: pose === 'icon', low: detail === 'low' }
  const col = palette(hue)
  const bob = st.still ? 0 : Math.sin(phase * 2) * 1.6 * Math.min(1, 0.35 + speed / 120)
  const lean = st.still ? 0 : dir * Math.min(1, speed / 220) * 0.09
  const look = st.still ? 0 : dir

  ctx.save()
  ctx.scale(scale, scale)

  if (shadow) drawShadow(ctx, speed)

  ctx.save()
  ctx.translate(0, bob)
  ctx.rotate(lean)

  if (heat > 0.35) {
    ctx.shadowColor = col.glow
    ctx.shadowBlur = 8 + heat * 22
  }

  drawLegs(ctx, -1, phase, col, st)
  drawLegs(ctx, 1, phase, col, st)
  drawClaw(ctx, -1, phase, speed, col, st, lostClaw === -1 ? regrow : 1)
  drawClaw(ctx, 1, phase, speed, col, st, lostClaw === 1 ? regrow : 1)
  drawBody(ctx, col, st)
  ctx.shadowBlur = 0
  drawEyes(ctx, look, blink, phase, col, st)

  ctx.restore()

  if (heat > 0.55) drawSteam(ctx, time, heat, col)

  ctx.restore()
}

function drawShadow(ctx, speed) {
  const w = 38 + Math.min(8, speed / 25)
  ctx.save()
  ctx.globalAlpha = 0.22
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.ellipse(0, 1, w, 4.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawBody(ctx, col, st) {
  const cx = 0
  const cy = -26
  const rx = 28
  const ry = 17

  const grad = ctx.createLinearGradient(0, cy - ry, 0, cy + ry)
  grad.addColorStop(0, col.light)
  grad.addColorStop(0.45, col.base)
  grad.addColorStop(1, col.dark)

  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.lineWidth = st.low ? 3.5 : 2
  ctx.strokeStyle = col.deep
  ctx.stroke()

  if (st.low) return // 小圖示上殼紋、高光、嘴都只會糊成雜點

  // 殼上的紋路
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.strokeStyle = col.deep
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(-15, cy - 3)
  ctx.quadraticCurveTo(0, cy - 9, 15, cy - 3)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-9, cy + 6)
  ctx.quadraticCurveTo(0, cy + 2, 9, cy + 6)
  ctx.stroke()
  ctx.restore()

  // 高光
  ctx.save()
  ctx.globalAlpha = 0.35
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.ellipse(-10, cy - 8, 8, 4, -0.35, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // 嘴
  ctx.save()
  ctx.strokeStyle = col.deep
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-4, cy + 10)
  ctx.quadraticCurveTo(0, cy + 13, 4, cy + 10)
  ctx.stroke()
  ctx.restore()
}

function drawLegs(ctx, side, phase, col, st) {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const count = st.low ? 3 : LEGS_PER_SIDE
  for (let i = 0; i < count; i++) {
    // 左右兩側相位差 π，走起來才像交替踏步；靜止站姿則完全不擺動，左右才會對稱
    const p = phase + i * 0.8 + (side < 0 ? 0 : Math.PI)
    const s = st.still ? 0 : Math.sin(p)
    const lift = Math.max(0, s)

    // 往外扇開，每隻腳才分得出來（身體 rx 是 28，落點要明顯超過才看得到）
    const hipX = side * (20 - i * 2)
    const hipY = st.low ? -30 + i * 6 : -32 + i * 3.5
    const spread = st.low ? 30 + i * 7 : 33 + i * 5
    const footX = side * (spread + s * 5) // 擺幅壓在 5 以內，收腳時才不會縮到身體後面看不見
    const footY = -lift * 8
    const kneeX = side * (spread * 0.6)
    const kneeY = hipY - 12 - lift * 6

    ctx.beginPath()
    ctx.moveTo(hipX, hipY)
    ctx.quadraticCurveTo(kneeX, kneeY, footX, footY)
    ctx.strokeStyle = col.dark
    ctx.lineWidth = st.low ? 6.5 : 3.4 - i * 0.25
    ctx.stroke()

    if (st.low) continue

    // 腳尖
    ctx.beginPath()
    ctx.moveTo(footX, footY)
    ctx.lineTo(footX + side * 4, footY + 1.5)
    ctx.strokeStyle = col.deep
    ctx.lineWidth = 2.2
    ctx.stroke()
  }

  ctx.restore()
}

/** grow（0..1）是這隻螯長到幾成：0 是被甩掉了只剩一小截，之後從肩膀慢慢長回來。 */
function drawClaw(ctx, side, phase, speed, col, st, grow = 1) {
  // 跑越快、螯揮得越開；站著的時候會慢慢一開一合
  const idle = st.still ? 0.7 : (Math.sin(phase * 0.9 + (side < 0 ? 0 : 1.7)) + 1) / 2
  const open = st.still ? 0.42 : 0.12 + idle * 0.34 + Math.min(0.25, speed / 900)

  const reach = st.low ? 36 : 40
  const shoulderX = side * 24
  const shoulderY = -36
  const elbowX = side * (reach - 6)
  const elbowY = -46 - idle * 3
  const handX = side * reach
  const handY = -54 - idle * 5

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (grow < 1) {
    // 斷掉的地方留一小截
    ctx.beginPath()
    ctx.ellipse(shoulderX + side * 3, shoulderY - 2, 4, 3.4, 0, 0, Math.PI * 2)
    ctx.fillStyle = col.dark
    ctx.fill()
    if (grow <= 0.02) {
      ctx.restore()
      return
    }
    // 長回來：以肩膀為中心從小變大
    ctx.translate(shoulderX, shoulderY)
    ctx.scale(grow, grow)
    ctx.translate(-shoulderX, -shoulderY)
  }

  // 手臂
  ctx.beginPath()
  ctx.moveTo(shoulderX, shoulderY)
  ctx.quadraticCurveTo(elbowX, elbowY, handX, handY)
  ctx.strokeStyle = col.dark
  ctx.lineWidth = st.low ? 7 : 4.5
  ctx.stroke()

  // 螯
  ctx.translate(handX, handY)
  ctx.rotate(side * -0.5)
  drawPincer(ctx, side, open, col, st)
  ctx.restore()
}

/** 螯本身（兩片夾子和根部），原點在根部。 */
function drawPincer(ctx, side, open, col, st) {
  const edge = st.low ? 2.4 : 1.6
  const jaw = (angle, len, thick) => {
    ctx.save()
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.ellipse(len * 0.45, 0, len * 0.5, thick, 0, 0, Math.PI * 2)
    ctx.fillStyle = col.base
    ctx.fill()
    ctx.lineWidth = edge
    ctx.strokeStyle = col.deep
    ctx.stroke()
    ctx.restore()
  }

  jaw(side * open, st.low ? 17 : 16, st.low ? 7.5 : 5.5)
  jaw(side * -open * 0.8, st.low ? 15 : 14, st.low ? 6 : 4.2)

  // 螯的根部
  ctx.beginPath()
  ctx.ellipse(0, 0, st.low ? 8.5 : 7, st.low ? 7.5 : 6, 0, 0, Math.PI * 2)
  ctx.fillStyle = col.base
  ctx.fill()
  ctx.lineWidth = edge
  ctx.strokeStyle = col.deep
  ctx.stroke()
}

/** 被甩掉、掉在地上的那隻螯（原點在螯的中間，angle 是轉了多少）。 */
function drawLooseClaw(ctx, { scale = 1, hue = 186, side = 1, angle = 0 } = {}) {
  const col = palette(hue)
  const st = { still: false, low: false }
  ctx.save()
  ctx.scale(scale, scale)
  ctx.rotate(angle)
  // 夾子都朝 +x 長，斷掉的那一小截手臂接在 -x 那一側
  ctx.beginPath()
  ctx.moveTo(-14, 3)
  ctx.lineTo(-4, 0)
  ctx.lineCap = 'round'
  ctx.lineWidth = 4.5
  ctx.strokeStyle = col.dark
  ctx.stroke()
  ctx.translate(-4, 0)
  drawPincer(ctx, side, 0.3, col, st)
  ctx.restore()
}

function drawEyes(ctx, look, blink, phase, col, st) {
  const sway = st.still ? 0 : Math.sin(phase * 1.4) * 0.8
  const r = st.low ? 7 : 5

  for (const side of [-1, 1]) {
    const baseX = side * (st.low ? 10 : 9)
    const baseY = -38
    const topX = baseX + sway * side * 0.4 + look * 1.5
    const topY = -56

    ctx.beginPath()
    ctx.moveTo(baseX, baseY)
    ctx.quadraticCurveTo(baseX + look * 1.5, -48, topX, topY)
    ctx.strokeStyle = col.dark
    ctx.lineWidth = st.low ? 5 : 3.2
    ctx.lineCap = 'round'
    ctx.stroke()

    ctx.beginPath()
    ctx.ellipse(topX, topY, r, r * (1 - blink * 0.85), 0, 0, Math.PI * 2)
    ctx.fillStyle = '#fdfdff'
    ctx.fill()
    ctx.lineWidth = st.low ? 2 : 1.4
    ctx.strokeStyle = col.deep
    ctx.stroke()

    if (blink < 0.6) {
      ctx.beginPath()
      // 瞳孔往前進方向看
      ctx.ellipse(topX + look * 1.8, topY, st.low ? 3.2 : 2.1, (st.low ? 3.4 : 2.4) * (1 - blink), 0, 0, Math.PI * 2)
      ctx.fillStyle = '#16181d'
      ctx.fill()
    }
  }
}

function drawSteam(ctx, time, heat, col) {
  ctx.save()
  ctx.globalAlpha = 0.18 + heat * 0.25
  ctx.strokeStyle = col.glow
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.0012 + i * 0.37) % 1
    const x = -12 + i * 12
    const y = -46 - t * 34
    ctx.globalAlpha = (0.18 + heat * 0.3) * (1 - t)
    ctx.beginPath()
    ctx.moveTo(x + Math.sin(t * 6 + i) * 3, y)
    ctx.lineTo(x + Math.sin(t * 6 + i + 0.8) * 3, y - 6)
    ctx.stroke()
  }
  ctx.restore()
}

/** 低負載時吐幾顆泡泡，讓螃蟹站著也有事做。 */
function drawBubbles(ctx, bubbles, scale) {
  ctx.save()
  ctx.scale(scale, scale)
  ctx.strokeStyle = 'rgba(210, 244, 255, 0.75)'
  ctx.fillStyle = 'rgba(180, 230, 255, 0.18)'
  ctx.lineWidth = 1.2
  for (const b of bubbles) {
    ctx.globalAlpha = b.alpha
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

// ---------------------------------------------------------------- 圖示

const boundsCache = {}

/** 實際畫一次再掃 alpha 求外框，改了螃蟹長相後圖示的置中與縮放會自動跟上。 */
function artBounds(detail) {
  if (boundsCache[detail]) return boundsCache[detail]

  const S = 4
  const W = 160 * S
  const H = 120 * S
  const ox = W / 2
  const oy = H * 0.8
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  ctx.translate(ox, oy)
  drawCrab(ctx, { scale: S, pose: 'icon', detail, shadow: false })

  const { data } = ctx.getImageData(0, 0, W, H)
  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  const bounds = {
    left: (minX - ox) / S,
    right: (maxX + 1 - ox) / S,
    top: (minY - oy) / S,
    bottom: (maxY + 1 - oy) / S,
  }
  boundsCache[detail] = bounds
  return bounds
}

/**
 * 把靜止站姿的螃蟹畫成 size×size 的 PNG data URL。
 * 32px 以下自動改用低細節畫法，否則細線會糊成一團。
 */
function renderIcon(size, hue = 186, detail = size <= 32 ? 'low' : 'high') {
  const b = artBounds(detail)
  const w = b.right - b.left
  const h = b.bottom - b.top
  const pad = size <= 32 ? 0 : size * 0.04 // 小圖示一個像素都不浪費
  const s = (size - pad * 2) / Math.max(w, h)

  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  ctx.translate(size / 2 - ((b.left + b.right) / 2) * s, size / 2 - ((b.top + b.bottom) / 2) * s)
  drawCrab(ctx, { scale: s, hue, pose: 'icon', detail, shadow: false })
  return c.toDataURL('image/png')
}

window.CrabArt = { drawCrab, drawBubbles, drawLooseClaw, loadToHue, palette, renderIcon }
})()
