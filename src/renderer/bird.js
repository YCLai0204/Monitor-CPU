'use strict'

/**
 * 搖頭小鳥（黃頰／綠頰小鸚鵡，奶油色的頭、橘色臉頰、綠色的背、橘黃色的肚子）。
 * 跟螃蟹一樣是用 Canvas 即時畫出來的，沒有圖檔，所以圖示在 16px 也是清楚的向量畫法。
 *
 * 座標原點放在小鳥的「腳底中心」，往上是負的，面向觀眾。
 * 最重要的動作是搖頭：頭以脖子為軸左右擺，擺動的相位由呼叫端用 bob（弧度）給，
 * 負載越高，呼叫端就讓 bob 走得越快。
 *
 * 低負載時走路（收翅膀、小跳步）；高負載時展翅飛（拍翅膀、離地、身後有速度線）。
 *
 * 包在 IIFE 裡的理由同 crab.js：兩支 <script> 共用全域範圍，避免同名變數衝突。
 */
;(function () {
const C = {
  outline: '#4a3b2a',
  crown: '#b9a588',
  face: '#e6d6ba',
  cheek: '#ec8a4b',
  brow: '#d4533c',
  beak: '#f3dccf',
  beakEdge: '#b98d84',
  belly: '#efa651',
  bellyLow: '#dcc44e',
  chest: '#e9d9bd',
  back: '#6f9a2b',
  wing: '#7fa832',
  wingDark: '#4f7d22',
  feather: '#5e9a52',
  leg: '#e9b3aa',
  legEdge: '#b98077',
  eye: '#17181c',
}

function drawBird(ctx, opts) {
  const {
    scale = 1,
    phase = 0,       // 走路步伐的相位
    bob = 0,         // 搖頭的相位（弧度）
    flap = 0,        // 拍翅膀的相位（弧度）
    speed = 0,
    dir = 1,
    flying = false,
    heat = 0,        // 0..1，越高臉越紅
    blink = 0,
    pose = 'walk',   // 'icon'：靜止站姿，搖頭幅度加大
    detail = 'high', // 'low'：線條加粗、省略細節，給小圖示用
    shadow = true,
    time = 0,
  } = opts

  const still = pose === 'icon'
  const low = detail === 'low'
  const lw = low ? 2.6 : 1.5

  const swing = Math.sin(bob)
  const headAngle = swing * (still ? 0.5 : 0.5)
  const headShift = swing * (still ? 2.5 : 4)

  const lean = still ? 0 : dir * Math.min(1, speed / 220) * 0.1 + (flying ? dir * 0.12 : 0)
  const hop = still || flying ? 0 : Math.abs(Math.sin(phase)) * Math.min(3.2, speed / 40)
  const air = flying ? 16 + Math.sin(flap * 0.5) * 3 : 0

  ctx.save()
  ctx.scale(scale, scale)

  if (shadow) drawShadow(ctx, air)

  ctx.save()
  ctx.translate(0, -air - hop)
  ctx.rotate(lean)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (flying && !still) drawSpeedLines(ctx, dir, time)

  drawLegs(ctx, phase, still, flying, low)
  if (flying) {
    drawWing(ctx, -1, wingAngle(flap, -1), low)
    drawWing(ctx, 1, wingAngle(flap, 1), low)
  }
  drawBody(ctx, flying, low, lw)
  drawHead(ctx, headAngle, headShift, blink, heat, low, lw)

  ctx.restore()
  ctx.restore()
}

function wingAngle(flap, side) {
  // 往上 -1.2 rad 到往下 +0.6 rad 之間拍動，左右同步
  return -0.3 + Math.sin(flap) * 0.9
}

function drawShadow(ctx, air) {
  const w = 22 - Math.min(6, air * 0.3)
  ctx.save()
  ctx.globalAlpha = air ? 0.14 : 0.22
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.ellipse(0, 1, w, 3.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawSpeedLines(ctx, dir, time) {
  ctx.save()
  ctx.strokeStyle = 'rgba(235, 245, 255, 0.55)'
  ctx.lineWidth = 2
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.004 + i * 0.33) % 1
    const y = -52 + i * 14
    const x0 = -dir * (30 + t * 22)
    ctx.globalAlpha = 1 - t
    ctx.beginPath()
    ctx.moveTo(x0, y)
    ctx.lineTo(x0 - dir * 12, y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawLegs(ctx, phase, still, flying, low) {
  ctx.save()
  for (const side of [-1, 1]) {
    const step = still || flying ? 0 : Math.max(0, Math.sin(phase + (side < 0 ? 0 : Math.PI)))
    const lift = flying ? 3 : step * 3
    const x = side * 7
    ctx.strokeStyle = C.leg
    ctx.lineWidth = low ? 4.2 : 3
    ctx.beginPath()
    ctx.moveTo(x, -9)
    ctx.lineTo(x, -lift - 1)
    ctx.stroke()
    // 腳趾
    ctx.lineWidth = low ? 3 : 2.2
    ctx.beginPath()
    ctx.moveTo(x - 4.5, -lift + 0.5)
    ctx.lineTo(x, -lift - 1)
    ctx.lineTo(x + 4.5, -lift + 0.5)
    ctx.stroke()
    if (!low && side < 0) {
      ctx.fillStyle = '#e9b93a' // 腳環
      ctx.fillRect(x - 2.4, -8, 4.8, 2.6)
    }
  }
  ctx.restore()
}

function drawWing(ctx, side, angle, low) {
  ctx.save()
  ctx.translate(side * 16, -33)
  ctx.scale(side, 1)
  ctx.rotate(angle)
  const len = 40
  ctx.beginPath()
  ctx.moveTo(0, -6)
  ctx.quadraticCurveTo(len * 0.55, -13, len, -1)
  ctx.quadraticCurveTo(len * 0.6, 12, 0, 7)
  ctx.closePath()
  ctx.fillStyle = C.wing
  ctx.fill()
  ctx.lineWidth = low ? 2.4 : 1.4
  ctx.strokeStyle = C.outline
  ctx.stroke()
  if (!low) {
    // 飛羽的藍綠色
    ctx.beginPath()
    ctx.moveTo(len * 0.45, -5)
    ctx.quadraticCurveTo(len * 0.75, -6, len, -1)
    ctx.quadraticCurveTo(len * 0.75, 6, len * 0.45, 4)
    ctx.closePath()
    ctx.fillStyle = C.feather
    ctx.fill()
  }
  ctx.restore()
}

function drawBody(ctx, flying, low, lw) {
  // 綠色的背，從肚子兩側露出來
  ctx.beginPath()
  ctx.ellipse(0, -24, 21, 25, 0, 0, Math.PI * 2)
  ctx.fillStyle = C.back
  ctx.fill()
  ctx.lineWidth = lw
  ctx.strokeStyle = C.outline
  ctx.stroke()

  // 橘黃色的肚子
  const g = ctx.createLinearGradient(0, -46, 0, -1)
  g.addColorStop(0, C.chest)
  g.addColorStop(0.35, C.belly)
  g.addColorStop(1, C.bellyLow)
  ctx.beginPath()
  ctx.ellipse(0, -23, 14.5, 22, 0, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()

  if (!flying) {
    // 收起來的翅膀，貼在身體兩側
    for (const side of [-1, 1]) {
      ctx.save()
      ctx.translate(side * 16.5, -27)
      ctx.rotate(-side * 0.1)
      ctx.beginPath()
      ctx.ellipse(0, 0, 6.2, 19, 0, 0, Math.PI * 2)
      ctx.fillStyle = C.wing
      ctx.fill()
      ctx.lineWidth = lw
      ctx.strokeStyle = C.outline
      ctx.stroke()
      if (!low) {
        ctx.beginPath()
        ctx.ellipse(0, 9, 3.6, 8, 0, 0, Math.PI * 2)
        ctx.fillStyle = C.feather
        ctx.fill()
      }
      ctx.restore()
    }
  }

  if (!low) {
    // 胸口的羽毛紋
    ctx.save()
    ctx.strokeStyle = 'rgba(160, 90, 40, 0.28)'
    ctx.lineWidth = 1.2
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.arc(0, -30 + i * 8, 8 - i, 0.2 * Math.PI, 0.8 * Math.PI)
      ctx.stroke()
    }
    ctx.restore()
  }
}

function drawHead(ctx, angle, shift, blink, heat, low, lw) {
  const pivotY = -36 // 脖子的位置，頭繞這裡擺
  ctx.save()
  ctx.translate(shift, pivotY)
  ctx.rotate(angle)
  ctx.translate(0, -pivotY)

  const cy = -52
  const r = 17.5

  // 頭：頂上灰褐、臉奶油色
  const g = ctx.createLinearGradient(0, cy - r, 0, cy + r)
  g.addColorStop(0, C.crown)
  g.addColorStop(0.45, C.face)
  g.addColorStop(1, C.chest)
  ctx.beginPath()
  ctx.ellipse(0, cy, r, r * 0.96, 0, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = lw
  ctx.strokeStyle = C.outline
  ctx.stroke()

  // 橘色臉頰
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.ellipse(side * 10.5, cy + 4, low ? 6.5 : 6, low ? 6 : 5.4, 0, 0, Math.PI * 2)
    ctx.fillStyle = C.cheek
    ctx.fill()
  }
  if (heat > 0) {
    ctx.beginPath()
    ctx.ellipse(0, cy, r, r * 0.96, 0, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 50, 35, ${heat * 0.32})`
    ctx.fill()
  }

  // 眼睛（白色眼圈，黑色眼珠）
  for (const side of [-1, 1]) {
    const ex = side * 8.5
    const ey = cy - 3.5
    ctx.beginPath()
    ctx.ellipse(ex, ey, low ? 4.4 : 4, (low ? 4.4 : 4) * (1 - blink * 0.9), 0, 0, Math.PI * 2)
    ctx.fillStyle = '#fbfbfd'
    ctx.fill()
    if (!low) {
      ctx.lineWidth = 0.9
      ctx.strokeStyle = C.outline
      ctx.stroke()
    }
    if (blink < 0.6) {
      ctx.beginPath()
      ctx.ellipse(ex, ey, low ? 2.8 : 2.3, (low ? 2.9 : 2.5) * (1 - blink), 0, 0, Math.PI * 2)
      ctx.fillStyle = C.eye
      ctx.fill()
    }
  }

  if (!low) {
    // 眉心的紅色斑
    ctx.beginPath()
    ctx.moveTo(-5, cy - 9)
    ctx.quadraticCurveTo(0, cy - 12, 5, cy - 9)
    ctx.lineWidth = 2
    ctx.strokeStyle = C.brow
    ctx.stroke()
  }

  // 彎彎的喙，尖端朝下
  ctx.beginPath()
  ctx.moveTo(-6, cy - 4)
  ctx.quadraticCurveTo(-7.2, cy + 7, 0, cy + 14)
  ctx.quadraticCurveTo(7.2, cy + 7, 6, cy - 4)
  ctx.quadraticCurveTo(0, cy - 7.5, -6, cy - 4)
  ctx.closePath()
  ctx.fillStyle = C.beak
  ctx.fill()
  ctx.lineWidth = low ? 2.2 : 1.3
  ctx.strokeStyle = C.beakEdge
  ctx.stroke()
  if (!low) {
    ctx.beginPath()
    ctx.moveTo(-2.4, cy - 2)
    ctx.quadraticCurveTo(-3.2, cy + 5, -0.8, cy + 9)
    ctx.lineWidth = 1.6
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.stroke()
  }

  ctx.restore()
}

// ---------------------------------------------------------------- 圖示

const boundsCache = {}

/** 把搖到兩側和正中間的樣子疊起來求外框，圖示這樣置中、縮放後搖頭才不會被切到。 */
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
  for (const bob of [0, Math.PI / 2, -Math.PI / 2]) {
    drawBird(ctx, { scale: S, bob, pose: 'icon', detail, shadow: false })
  }

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
 * 把搖頭中的小鳥畫成 size×size 的 PNG data URL。
 * turn 是搖頭週期走到哪（0..1），系統匣依序切換不同的 turn 就是搖頭動畫。
 */
function renderIcon(size, turn = 0, detail = size <= 32 ? 'low' : 'high') {
  const b = artBounds(detail)
  const w = b.right - b.left
  const h = b.bottom - b.top
  const pad = size <= 32 ? 0 : size * 0.04
  const s = (size - pad * 2) / Math.max(w, h)

  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  ctx.translate(size / 2 - ((b.left + b.right) / 2) * s, size / 2 - ((b.top + b.bottom) / 2) * s)
  drawBird(ctx, { scale: s, bob: turn * Math.PI * 2, pose: 'icon', detail, shadow: false })
  return c.toDataURL('image/png')
}

window.BirdArt = { drawBird, renderIcon }
})()
