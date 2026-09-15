'use strict'

/**
 * 螃蟹是用 Canvas 即時畫出來的，沒有任何圖檔或動畫序列。
 * 好處是顏色可以隨著負載連續變化（青色 → 紅色），腳的擺動頻率
 * 也能直接綁在移動速度上，跑越快腳就踏越急。
 *
 * 座標原點放在螃蟹的「腳底中心」，往上是負的。預設面向觀眾，
 * 靠橫向平移來走路（螃蟹本來就是橫著走）。
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
    heat = 0,       // 0..1，越高越「燙」，會加上光暈與蒸氣
    blink = 0,      // 0..1，1 = 完全閉眼
    time = 0,
  } = opts

  const col = palette(hue)
  const bob = Math.sin(phase * 2) * 1.6 * Math.min(1, 0.35 + speed / 120)
  const lean = dir * Math.min(1, speed / 220) * 0.09

  ctx.save()
  ctx.scale(scale, scale)

  drawShadow(ctx, speed)

  ctx.save()
  ctx.translate(0, bob)
  ctx.rotate(lean)

  if (heat > 0.35) {
    ctx.shadowColor = col.glow
    ctx.shadowBlur = 8 + heat * 22
  }

  drawLegs(ctx, -1, phase, col)
  drawLegs(ctx, 1, phase, col)
  drawClaw(ctx, -1, phase, speed, col)
  drawClaw(ctx, 1, phase, speed, col)
  drawBody(ctx, col)
  ctx.shadowBlur = 0
  drawEyes(ctx, dir, blink, phase, col)

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

function drawBody(ctx, col) {
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
  ctx.lineWidth = 2
  ctx.strokeStyle = col.deep
  ctx.stroke()

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

function drawLegs(ctx, side, phase, col) {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (let i = 0; i < LEGS_PER_SIDE; i++) {
    // 左右兩側相位差 π，走起來才像交替踏步
    const p = phase + i * 0.8 + (side < 0 ? 0 : Math.PI)
    const s = Math.sin(p)
    const lift = Math.max(0, s)

    // 往外扇開，四隻腳才分得出來（身體 rx 是 28，落點要明顯超過才看得到）
    const hipX = side * (20 - i * 2)
    const hipY = -32 + i * 3.5
    const spread = 33 + i * 5
    const footX = side * (spread + s * 5) // 擺幅壓在 5 以內，收腳時才不會縮到身體後面看不見
    const footY = -lift * 8
    const kneeX = side * (spread * 0.6)
    const kneeY = hipY - 12 - lift * 6

    ctx.beginPath()
    ctx.moveTo(hipX, hipY)
    ctx.quadraticCurveTo(kneeX, kneeY, footX, footY)
    ctx.strokeStyle = col.dark
    ctx.lineWidth = 3.4 - i * 0.25
    ctx.stroke()

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

function drawClaw(ctx, side, phase, speed, col) {
  // 跑越快、螯揮得越開；站著的時候會慢慢一開一合
  const idle = (Math.sin(phase * 0.9 + (side < 0 ? 0 : 1.7)) + 1) / 2
  const open = 0.12 + idle * 0.34 + Math.min(0.25, speed / 900)

  const shoulderX = side * 24
  const shoulderY = -36
  const elbowX = side * 34
  const elbowY = -46 - idle * 3
  const handX = side * 40
  const handY = -54 - idle * 5

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // 手臂
  ctx.beginPath()
  ctx.moveTo(shoulderX, shoulderY)
  ctx.quadraticCurveTo(elbowX, elbowY, handX, handY)
  ctx.strokeStyle = col.dark
  ctx.lineWidth = 4.5
  ctx.stroke()

  // 螯
  ctx.translate(handX, handY)
  ctx.rotate(side * -0.5)

  const jaw = (angle, len, thick) => {
    ctx.save()
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.ellipse(len * 0.45, 0, len * 0.5, thick, 0, 0, Math.PI * 2)
    ctx.fillStyle = col.base
    ctx.fill()
    ctx.lineWidth = 1.6
    ctx.strokeStyle = col.deep
    ctx.stroke()
    ctx.restore()
  }

  jaw(side * open, 16, 5.5)
  jaw(side * -open * 0.8, 14, 4.2)

  // 螯的根部
  ctx.beginPath()
  ctx.ellipse(0, 0, 7, 6, 0, 0, Math.PI * 2)
  ctx.fillStyle = col.base
  ctx.fill()
  ctx.lineWidth = 1.6
  ctx.strokeStyle = col.deep
  ctx.stroke()

  ctx.restore()
}

function drawEyes(ctx, dir, blink, phase, col) {
  const sway = Math.sin(phase * 1.4) * 0.8

  for (const side of [-1, 1]) {
    const baseX = side * 9
    const baseY = -38
    const topX = baseX + sway * side * 0.4 + dir * 1.5
    const topY = -56

    ctx.beginPath()
    ctx.moveTo(baseX, baseY)
    ctx.quadraticCurveTo(baseX + dir * 1.5, -48, topX, topY)
    ctx.strokeStyle = col.dark
    ctx.lineWidth = 3.2
    ctx.lineCap = 'round'
    ctx.stroke()

    const r = 5
    ctx.beginPath()
    ctx.ellipse(topX, topY, r, r * (1 - blink * 0.85), 0, 0, Math.PI * 2)
    ctx.fillStyle = '#fdfdff'
    ctx.fill()
    ctx.lineWidth = 1.4
    ctx.strokeStyle = col.deep
    ctx.stroke()

    if (blink < 0.6) {
      ctx.beginPath()
      // 瞳孔往前進方向看
      ctx.ellipse(topX + dir * 1.8, topY, 2.1, 2.4 * (1 - blink), 0, 0, Math.PI * 2)
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

window.CrabArt = { drawCrab, drawBubbles, loadToHue, palette }
})()
