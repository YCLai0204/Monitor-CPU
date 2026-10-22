'use strict'

/**
 * 黑面琵鷺（Q 版）：白色身體、繁殖期的淡黃色冠羽與胸前黃斑、眼睛周圍到嘴巴根部的黑色臉、
 * 黑色長扁嘴（尖端像湯匙）、黑色長腳。跟其他吉祥物一樣是用 Canvas 即時畫出來的，沒有圖檔。
 *
 * 座標原點放在「腳底中心」，往上是負的，面向觀眾。
 * 動作用的是小鳥那一套（app.js 的 'fly'），參數跟 bird.js 的 drawBird 一樣：
 *   flap / spread  拍翅膀的相位與翅膀張開的程度
 *   tilt           整隻鳥的傾斜（飛行時往前進方向倒、翻跟斗時整圈轉）
 *   look           -1..1，頭轉向左右；長嘴也跟著轉過去
 *   headTilt       歪頭
 *   peck           0..1，低頭覓食：黑面琵鷺是把湯匙嘴放進水裡左右掃，所以嘴會跟著掃動
 *   stretch        0..1，伸展單邊翅膀
 *   fluff / squash 蓬毛、落地壓扁
 *   legs           'stand' | 'walk' | 'tuck'（飛行時收腳）| 'dangle'（被抓起來時亂踢）
 *
 * 包在 IIFE 裡的理由同 crab.js：幾支 <script> 共用全域範圍，避免同名變數衝突。
 */
;(function () {
const C = {
  outline: '#5b6470',
  white: '#fbfbf8',
  shade: '#dfe3e8',
  primary: '#cfd5dc',
  crest: '#f2d77a',
  chest: '#f3dc8a',
  face: '#16171a',
  bill: '#1f2125',
  billHi: '#4a4e56',
  leg: '#1e1f23',
  eye: '#7a1f1f',
}

function drawSpoonbill(ctx, opts) {
  const {
    scale = 1,
    phase = 0,
    bob = 0,
    bobAmp = 1,
    flap = 0,
    spread = 0,
    tilt = 0,
    look = 0,
    headTilt = 0,
    peck = 0,
    stretch = 0,
    stretchSide = 1,
    fluff = 0,
    squash = 0,
    legs = 'stand',
    speed = 0,
    dir = 1,
    heat = 0,
    blink = 0,
    pose = 'live',
    detail = 'high',
    shadow = true,
    time = 0,
  } = opts

  const icon = pose === 'icon'
  const low = detail === 'low'
  const lw = low ? 2.4 : 1.4
  const wingsOut = spread > 0.3

  ctx.save()
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (shadow) {
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(0, 1, 20, 3.4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  if (squash > 0) ctx.scale(1 + squash * 0.14, 1 - squash * 0.14)

  // 傾斜繞著身體中心轉
  ctx.translate(0, -38)
  ctx.rotate(tilt)
  ctx.translate(0, 38)

  if (wingsOut && speed > 260) drawSpeedLines(ctx, dir, time)

  drawLegs(ctx, icon ? 'stand' : legs, phase, low)

  if (wingsOut) {
    const a = wingAngle(flap, spread)
    drawWing(ctx, -1, a, spread, low)
    drawWing(ctx, 1, a, spread, low)
  } else if (stretch > 0.05) {
    drawWing(ctx, stretchSide, 0.25 + stretch * 0.85, 0.35 + stretch * 0.65, low)
  }

  drawBody(ctx, fluff, low, lw, !wingsOut, stretch > 0.3 ? stretchSide : 0)
  drawHead(ctx, {
    swing: Math.sin(bob) * bobAmp,
    look,
    headTilt,
    peck,
    blink,
    heat,
    low,
    lw,
    time,
    hat: opts.hat, // 節日的帽子（holiday.js）
  })
  if (heat > 0.35 && !low && !icon) drawSweat(ctx, heat, time)

  ctx.restore()
}

function wingAngle(flap, spread) {
  return -0.25 + Math.sin(flap) * 0.95 * (0.4 + 0.6 * spread)
}

function drawSpeedLines(ctx, dir, time) {
  ctx.save()
  ctx.strokeStyle = 'rgba(235, 245, 255, 0.55)'
  ctx.lineWidth = 2
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.004 + i * 0.33) % 1
    const y = -60 + i * 14
    const x0 = -dir * (30 + t * 22)
    ctx.globalAlpha = 1 - t
    ctx.beginPath()
    ctx.moveTo(x0, y)
    ctx.lineTo(x0 - dir * 12, y)
    ctx.stroke()
  }
  ctx.restore()
}

/** 黑色長腳；飛行時往後收起來，只露出一小段。 */
function drawLegs(ctx, mode, phase, low) {
  ctx.save()
  for (const side of [-1, 1]) {
    const x = side * 5.5
    let top = -27
    let foot = -1
    let toeX = x
    if (mode === 'walk') {
      foot = -1 - Math.max(0, Math.sin(phase + (side < 0 ? 0 : Math.PI))) * 4
    } else if (mode === 'tuck') {
      top = -28
      foot = -18
    } else if (mode === 'dangle') {
      const kick = Math.sin(phase + (side < 0 ? 0 : Math.PI))
      foot = 4 + kick * 3
      toeX = x + kick * 3
    }
    ctx.strokeStyle = C.leg
    ctx.lineWidth = low ? 3.6 : 2.6
    ctx.beginPath()
    ctx.moveTo(x, top)
    // 膝蓋（其實是腳踝）稍微往外彎
    ctx.quadraticCurveTo(x + side * 2, (top + foot) / 2, toeX, foot)
    ctx.stroke()
    if (mode !== 'tuck') {
      ctx.lineWidth = low ? 2.8 : 2
      ctx.beginPath()
      ctx.moveTo(toeX - 5, foot + 1.5)
      ctx.lineTo(toeX, foot)
      ctx.lineTo(toeX + 5, foot + 1.5)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** 展開的白色翅膀，外側的飛羽帶一點灰。 */
function wingPath(ctx, L, low) {
  ctx.beginPath()
  ctx.moveTo(0, -7)
  ctx.quadraticCurveTo(L * 0.5, -15, L, -4)
  const feathers = low ? [] : [[0.93, 4], [0.75, 10], [0.55, 13], [0.35, 12]]
  for (const [f, fy] of feathers) {
    ctx.lineTo(L * f, fy)
    ctx.lineTo(L * (f - 0.08), fy - 5)
  }
  ctx.quadraticCurveTo(L * 0.14, 12, 0, 8)
  ctx.closePath()
}

function drawWing(ctx, side, angle, extend, low) {
  ctx.save()
  ctx.translate(side * 13, -44)
  ctx.scale(side, 1)
  ctx.rotate(angle)
  const L = 46 * (0.45 + 0.55 * Math.min(1, extend))
  wingPath(ctx, L, low)
  ctx.fillStyle = C.white
  ctx.fill()
  if (!low) {
    ctx.save()
    ctx.clip()
    ctx.fillStyle = C.primary
    ctx.fillRect(L * 0.62, -20, L, 40)
    ctx.restore()
    wingPath(ctx, L, low)
  }
  ctx.lineWidth = low ? 2.2 : 1.3
  ctx.strokeStyle = C.outline
  ctx.stroke()
  ctx.restore()
}

function drawBody(ctx, fluff, low, lw, folded, stretchedSide) {
  const k = 1 + fluff * 0.12
  // 白色的身體，下半部帶一點灰影
  const g = ctx.createLinearGradient(0, -54, 0, -22)
  g.addColorStop(0, C.white)
  g.addColorStop(1, C.shade)
  ctx.beginPath()
  ctx.ellipse(0, -38, 17 * k, 16 * k, 0, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = lw
  ctx.strokeStyle = C.outline
  ctx.stroke()

  if (!low) {
    // 繁殖期胸前的淡黃色
    ctx.beginPath()
    ctx.ellipse(0, -48, 7, 4.2, 0, 0, Math.PI * 2)
    ctx.fillStyle = C.chest
    ctx.globalAlpha = 0.8
    ctx.fill()
    ctx.globalAlpha = 1
  }

  if (folded) {
    // 收起來的翅膀貼在身體兩側
    for (const side of [-1, 1]) {
      if (side === stretchedSide) continue
      ctx.save()
      ctx.translate(side * 13 * k, -38)
      ctx.rotate(-side * 0.12)
      ctx.beginPath()
      ctx.ellipse(0, 0, 6, 15, 0, 0, Math.PI * 2)
      ctx.fillStyle = C.white
      ctx.fill()
      ctx.lineWidth = lw
      ctx.strokeStyle = C.outline
      ctx.stroke()
      if (!low) {
        ctx.beginPath()
        ctx.ellipse(0, 8, 3.6, 6, 0, 0, Math.PI * 2)
        ctx.fillStyle = C.primary
        ctx.fill()
      }
      ctx.restore()
    }
  }

  // 脖子
  ctx.beginPath()
  ctx.moveTo(0, -50)
  ctx.lineTo(0, -60)
  ctx.lineWidth = low ? 11 : 9
  ctx.strokeStyle = C.white
  ctx.stroke()
}

function drawHead(ctx, o) {
  const { swing, look, headTilt, peck, blink, heat, low, lw, time } = o
  const pivotY = -56 // 脖子，頭繞這裡擺
  const angle = swing * 0.4 + headTilt
  ctx.save()
  ctx.translate(swing * 3 + look * 1.5, pivotY + peck * 10)
  ctx.rotate(angle)
  ctx.translate(0, -pivotY)

  const cy = -68
  const r = 11.5
  const fx = look * 3

  if (!low) {
    // 繁殖期的淡黃色冠羽：從後腦勺往後垂下來的一束（正面看就是垂在轉頭方向的另一邊）
    const back = look > 0.05 ? -1 : 1
    ctx.save()
    ctx.strokeStyle = C.crest
    ctx.lineCap = 'round'
    for (const [w, dy, len] of [[3.2, 0, 15], [2.4, 2.5, 12], [2, -2, 11]]) {
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(back * 3, cy - r + 1.5)
      ctx.quadraticCurveTo(back * (r + 3), cy - r - 2 + dy, back * (r + len * 0.55), cy - r + len * 0.75 + dy)
      ctx.stroke()
    }
    ctx.restore()
  }

  // 白色的頭
  ctx.beginPath()
  ctx.ellipse(0, cy, r, r * 0.95, 0, 0, Math.PI * 2)
  ctx.fillStyle = C.white
  ctx.fill()
  ctx.lineWidth = lw
  ctx.strokeStyle = C.outline
  ctx.stroke()
  if (heat > 0) {
    ctx.fillStyle = `rgba(255, 90, 80, ${heat * 0.28})`
    ctx.fill()
  }

  // 黑色的臉：從眼睛一圈連到嘴巴根部
  ctx.beginPath()
  ctx.ellipse(fx, cy + 1.5, 9.5, 6.5, 0, 0, Math.PI * 2)
  ctx.fillStyle = C.face
  ctx.fill()

  // 眼睛：黑臉上畫白色眼白才看得到，眼珠是深紅色；兩隻保持一樣大，遠的那隻縮小會變成大小眼
  for (const side of [-1, 1]) {
    const k = 1
    const ex = side * 5 + fx * 1.1
    const ey = cy
    const er = low ? 3.2 : 2.6
    ctx.beginPath()
    ctx.ellipse(ex, ey, er * k, er * (1 - blink * 0.9), 0, 0, Math.PI * 2)
    ctx.fillStyle = '#fdfdfd'
    ctx.fill()
    if (blink < 0.6) {
      ctx.beginPath()
      ctx.ellipse(ex + look * 0.6, ey, er * 0.62 * k, er * 0.66 * (1 - blink), 0, 0, Math.PI * 2)
      ctx.fillStyle = C.eye
      ctx.fill()
      if (!low) {
        ctx.beginPath()
        ctx.arc(ex + look * 0.6 + 0.7, ey - 0.8, 0.6, 0, Math.PI * 2)
        ctx.fillStyle = '#fff'
        ctx.fill()
      }
    }
  }

  // 湯匙嘴：從臉的下緣往下長，轉頭時往那一邊擺；覓食時左右掃
  const sweep = peck > 0.2 ? Math.sin(time * 0.012) * 0.35 * peck : 0
  const billAngle = -look * 0.75 + sweep
  drawBill(ctx, fx, cy + 5, billAngle, low)

  // 節日的帽子：戴在頭頂（冠羽從帽子後面垂下來）
  if (o.hat && window.HolidayArt) window.HolidayArt.drawHat(ctx, o.hat, fx * 0.4, cy - r + 3, 19)
  ctx.restore()
}

/** 黑色長扁嘴，尖端是寬寬的湯匙。(x, y) 是嘴巴根部，angle 是從正下方往旁邊擺的角度。 */
function drawBill(ctx, x, y, angle, low) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  const len = 24
  ctx.beginPath()
  ctx.moveTo(-2.8, 0)
  ctx.quadraticCurveTo(-2.2, len * 0.6, -2, len - 6)
  // 湯匙
  ctx.quadraticCurveTo(-6.5, len - 4, -5.5, len)
  ctx.quadraticCurveTo(-3, len + 4.5, 0, len + 4.5)
  ctx.quadraticCurveTo(3, len + 4.5, 5.5, len)
  ctx.quadraticCurveTo(6.5, len - 4, 2, len - 6)
  ctx.quadraticCurveTo(2.2, len * 0.6, 2.8, 0)
  ctx.closePath()
  ctx.fillStyle = C.bill
  ctx.fill()
  if (!low) {
    // 嘴上的亮線
    ctx.beginPath()
    ctx.moveTo(-0.8, 2)
    ctx.lineTo(-0.6, len - 6)
    ctx.lineWidth = 1
    ctx.strokeStyle = C.billHi
    ctx.stroke()
  }
  ctx.restore()
}

function drawSweat(ctx, heat, time) {
  ctx.save()
  const n = heat > 0.7 ? 2 : 1
  for (let i = 0; i < n; i++) {
    const t = (time * 0.0012 + i * 0.5) % 1
    const side = i === 0 ? 1 : -1
    const x = side * (15 + t * 3)
    const y = -76 + t * 14
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

// ---------------------------------------------------------------- 圖示

/** 圖示用的外框（腳底為原點）。小圖示只取頭和湯匙嘴，整隻縮下去會看不清楚。 */
const ICON_BOUNDS = { left: -26, right: 26, top: -86, bottom: 2 }
const ICON_BUST = { left: -16, right: 16, top: -84, bottom: -36 }

function renderIcon(size, detail = size <= 32 ? 'low' : 'high') {
  const b = size <= 32 ? ICON_BUST : ICON_BOUNDS
  const pad = size <= 32 ? 0 : size * 0.04
  const s = (size - pad * 2) / Math.max(b.right - b.left, b.bottom - b.top)
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  ctx.translate(size / 2 - ((b.left + b.right) / 2) * s, size / 2 - ((b.top + b.bottom) / 2) * s)
  drawSpoonbill(ctx, { scale: s, pose: 'icon', detail, shadow: false, look: 0.35 })
  return c.toDataURL('image/png')
}

window.MascotArt = Object.assign(window.MascotArt || {}, { spoonbill: { draw: drawSpoonbill, renderIcon } })
})()
