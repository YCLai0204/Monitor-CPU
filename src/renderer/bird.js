'use strict'

/**
 * 小鳥（鳳梨綠頰鸚哥：灰褐色頭頂、白色眼圈、橘紅臉頰、紅橘色肚子、黃色兩側、綠色翅膀、暗紅長尾巴）。
 * 跟螃蟹一樣是用 Canvas 即時畫出來的，沒有圖檔，所以圖示在 16px 也是清楚的向量畫法。
 *
 * 座標原點放在小鳥的「腳底中心」，往上是負的，面向觀眾。
 * 這支只管「畫成什麼姿勢」，要做什麼動作（走、飛、啄、理毛…）由 app.js 決定後用參數傳進來：
 *
 *   bob / bobAmp   左右搖頭的相位（弧度）與幅度；只有右下角的圖示會搖頭，桌面上的小鳥 bobAmp = 0
 *   flap / spread  拍翅膀的相位與翅膀張開的程度（0 = 收起來，1 = 完全展開）
 *   tilt           整隻鳥的傾斜（飛行時往前進方向倒、翻跟斗時整圈轉）
 *   look           -1..1，頭轉向左右（看往前進方向）
 *   headTilt       歪頭
 *   peck           0..1，低頭啄
 *   stretch        0..1，伸展單邊翅膀（stretchSide 決定哪一邊）
 *   fluff          0..1，蓬起羽毛
 *   squash         0..1，落地時壓扁一下
 *   legs           'stand' | 'walk' | 'tuck'（飛行時收腳）| 'dangle'（被抓起來時亂踢）
 *
 * 包在 IIFE 裡的理由同 crab.js：兩支 <script> 共用全域範圍，避免同名變數衝突。
 */
;(function () {
const C = {
  outline: '#4a3b2a',
  crown: '#b3a692',
  crownHi: '#d6ccbb',
  face: '#efe4d0',
  ring: '#fbfaf6',
  cheek: '#ec7a43',
  brow: '#d4533c',
  beak: '#f1dad0',
  beakEdge: '#b98d84',
  chest: '#efe1c8',
  bellyMid: '#f0b067',
  bellyRed: '#e4603a',
  bellyLow: '#e3c64c',
  back: '#6f9a2b',
  wing: '#82aa34',
  covert: '#9cc04a',
  primary: '#3f7e6c',
  feather: '#5e9a52',
  tail: '#8a3b3b',
  tailEdge: '#5f8c2a',
  leg: '#e9b3aa',
  band: '#e9b93a',
  eye: '#17181c',
}

function drawBird(ctx, opts) {
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
    tailSwing = 0,
    heat = 0,        // 0..1，越高臉越紅、開始冒汗
    blink = 0,
    pose = 'live',   // 'icon'：靜止站姿，給圖示用
    detail = 'high', // 'low'：線條加粗、省略細節，給小圖示用
    shadow = true,
    time = 0,
  } = opts

  const icon = pose === 'icon'
  const low = detail === 'low'
  const lw = low ? 2.6 : 1.5
  const wingsOut = spread > 0.3

  ctx.save()
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (shadow) drawShadow(ctx)

  // 落地壓扁：以腳底為基準
  if (squash > 0) ctx.scale(1 + squash * 0.14, 1 - squash * 0.14)

  // 傾斜繞著身體中心轉，翻跟斗時才不會甩得太開
  ctx.translate(0, -26)
  ctx.rotate(tilt)
  ctx.translate(0, 26)

  if (wingsOut && speed > 260) drawSpeedLines(ctx, dir, time)
  if (!low) drawTail(ctx, tailSwing)

  if (wingsOut) {
    const a = wingAngle(flap, spread)
    drawWing(ctx, -1, a, spread, low)
    drawWing(ctx, 1, a, spread, low)
  } else if (stretch > 0.05) {
    drawWing(ctx, stretchSide, 0.25 + stretch * 0.85, 0.35 + stretch * 0.65, low)
  }

  // 腳畫在身體前面，才看得到抓著東西的粉紅色腳趾
  drawBody(ctx, fluff, low, lw, !wingsOut, stretch > 0.3 ? stretchSide : 0)
  drawLegs(ctx, icon ? 'stand' : legs, phase, low)
  drawHead(ctx, {
    swing: Math.sin(bob) * bobAmp,
    icon,
    look,
    headTilt,
    peck,
    blink,
    heat,
    low,
    lw,
    hat: opts.hat, // 節日的帽子（holiday.js）
  })
  if (heat > 0.35 && !low && !icon) drawSweat(ctx, heat, time)

  ctx.restore()
}

/** 往上約 -1.2 rad 到往下 +0.7 rad 之間拍動；翅膀還沒完全張開時拍得小一點。 */
function wingAngle(flap, spread) {
  return -0.25 + Math.sin(flap) * 0.95 * (0.4 + 0.6 * spread)
}

function drawShadow(ctx) {
  ctx.save()
  ctx.globalAlpha = 0.22
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.ellipse(0, 1, 22, 3.6, 0, 0, Math.PI * 2)
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

/** 長尾巴垂在身體後面；正面看到的是暗紅色的底面，邊緣是綠色。 */
function drawTail(ctx, swing) {
  ctx.save()
  ctx.translate(0, -12)
  ctx.rotate(swing * 0.25)
  ctx.beginPath()
  ctx.moveTo(-7.5, 0)
  ctx.quadraticCurveTo(-6.5, 22, 0, 36)
  ctx.quadraticCurveTo(6.5, 22, 7.5, 0)
  ctx.closePath()
  ctx.fillStyle = C.tailEdge
  ctx.fill()
  ctx.lineWidth = 1.3
  ctx.strokeStyle = C.outline
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-4, 2)
  ctx.quadraticCurveTo(-3.6, 20, 0, 31)
  ctx.quadraticCurveTo(3.6, 20, 4, 2)
  ctx.closePath()
  ctx.fillStyle = C.tail
  ctx.fill()
  ctx.restore()
}

function drawLegs(ctx, mode, phase, low) {
  ctx.save()
  for (const side of [-1, 1]) {
    const x = side * 7
    let top = -9
    let foot = -1
    let toeX = x
    if (mode === 'walk') {
      foot = -1 - Math.max(0, Math.sin(phase + (side < 0 ? 0 : Math.PI))) * 3
    } else if (mode === 'tuck') {
      top = -11
      foot = -7
    } else if (mode === 'dangle') {
      const kick = Math.sin(phase + (side < 0 ? 0 : Math.PI))
      foot = 5 + kick * 3
      toeX = x + kick * 2.5
    }
    ctx.strokeStyle = C.leg
    ctx.lineWidth = low ? 4.2 : 3
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(toeX, foot)
    ctx.stroke()
    // 腳趾；收腳時縮成一小團
    const spreadToe = mode === 'tuck' ? 2.5 : 4.5
    ctx.lineWidth = low ? 3 : 2.2
    ctx.beginPath()
    ctx.moveTo(toeX - spreadToe, foot + 1.5)
    ctx.lineTo(toeX, foot)
    ctx.lineTo(toeX + spreadToe, foot + 1.5)
    ctx.stroke()
    if (!low && side < 0 && mode !== 'tuck') {
      ctx.fillStyle = C.band // 腳環
      ctx.fillRect(x - 2.4, -8, 4.8, 2.6)
    }
  }
  ctx.restore()
}

/** 展開的翅膀：從肩膀往外伸，後緣是一根根的飛羽。 */
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
  ctx.translate(side * 15, -34)
  ctx.scale(side, 1)
  ctx.rotate(angle)
  const L = 44 * (0.45 + 0.55 * Math.min(1, extend))
  wingPath(ctx, L, low)
  ctx.fillStyle = C.wing
  ctx.fill()
  if (!low) {
    ctx.save()
    ctx.clip()
    // 外側的飛羽帶一點藍綠色，靠肩膀那段是比較亮的覆羽
    ctx.fillStyle = C.primary
    ctx.fillRect(L * 0.58, -20, L, 40)
    ctx.fillStyle = C.covert
    ctx.beginPath()
    ctx.ellipse(L * 0.22, -5, L * 0.26, 5, -0.12, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    wingPath(ctx, L, low)
  }
  ctx.lineWidth = low ? 2.4 : 1.4
  ctx.strokeStyle = C.outline
  ctx.stroke()
  ctx.restore()
}

function drawBody(ctx, fluff, low, lw, folded, stretchedSide) {
  const k = 1 + fluff * 0.12

  // 綠色的背，從肚子兩側露出來
  ctx.beginPath()
  ctx.ellipse(0, -24, 21 * k, 25 * k, 0, 0, Math.PI * 2)
  ctx.fillStyle = C.back
  ctx.fill()
  ctx.lineWidth = lw
  ctx.strokeStyle = C.outline
  ctx.stroke()

  // 肚子：胸口奶油色，往下轉橘、兩側與下腹偏黃
  const g = ctx.createLinearGradient(0, -46, 0, -1)
  g.addColorStop(0, C.chest)
  g.addColorStop(0.35, C.bellyMid)
  g.addColorStop(1, C.bellyLow)
  ctx.beginPath()
  ctx.ellipse(0, -23, 14.5 * k, 22 * k, 0, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()
  if (!low) {
    // 肚子中間那一塊紅橘色
    const r = ctx.createRadialGradient(0, -19, 1, 0, -19, 13 * k)
    r.addColorStop(0, 'rgba(228, 96, 58, 0.9)')
    r.addColorStop(1, 'rgba(228, 96, 58, 0)')
    ctx.fillStyle = r
    ctx.fill()
  }

  if (folded) {
    // 收起來的翅膀，貼在身體兩側；伸展中的那一邊已經畫在外面了
    for (const side of [-1, 1]) {
      if (side === stretchedSide) continue
      ctx.save()
      ctx.translate(side * 16.5 * k, -27)
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
        ctx.fillStyle = C.primary
        ctx.fill()
      }
      ctx.restore()
    }
  }

  if (!low) {
    // 胸口一圈圈的羽毛紋
    ctx.save()
    ctx.strokeStyle = 'rgba(170, 70, 35, 0.3)'
    ctx.lineWidth = 1.2
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.arc(0, -30 + i * 8, 8 - i, 0.2 * Math.PI, 0.8 * Math.PI)
      ctx.stroke()
    }
    ctx.restore()
  }
}

function drawHead(ctx, o) {
  const { swing, icon, look, headTilt, peck, blink, heat, low, lw } = o
  const pivotY = -36 // 脖子的位置，頭繞這裡擺
  // 搖頭主要靠「轉臉」（五官往左右偏）表現，整顆頭只歪一點點；
  // 整顆頭歪太多的話兩隻眼睛會一高一低，看起來眼睛歪掉
  const angle = swing * 0.12 + headTilt
  const shift = swing * (icon ? 2.5 : 4) + look * 1.5
  const turn = Math.max(-1, Math.min(1, look + swing * 0.8))

  ctx.save()
  ctx.translate(shift, pivotY + peck * 9)
  ctx.rotate(angle)
  ctx.translate(0, -pivotY)

  const cy = -52
  const r = 17.5

  // 頭：頂上灰褐、臉奶油色
  const g = ctx.createLinearGradient(0, cy - r, 0, cy + r)
  g.addColorStop(0, C.crown)
  g.addColorStop(0.42, C.crownHi)
  g.addColorStop(0.6, C.face)
  g.addColorStop(1, C.chest)
  ctx.beginPath()
  ctx.ellipse(0, cy, r, r * 0.96, 0, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = lw
  ctx.strokeStyle = C.outline
  ctx.stroke()

  // 臉的五官跟著 turn 往左右偏，看起來像轉頭
  const fx = turn * 3.5

  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.ellipse(side * 10.5 + fx * 0.5, cy + 5, low ? 6.5 : 6, low ? 6 : 5.6, 0, 0, Math.PI * 2)
    ctx.fillStyle = C.cheek
    ctx.fill()
  }
  if (heat > 0) {
    ctx.beginPath()
    ctx.ellipse(0, cy, r, r * 0.96, 0, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 50, 35, ${heat * 0.32})`
    ctx.fill()
  }

  // 眼睛：綠頰鸚哥特有的白色裸眼圈，黑色眼珠
  for (const side of [-1, 1]) {
    // 兩隻眼睛保持一樣大，只跟著五官一起偏；遠的那隻縮小會變成大小眼
    const k = 1
    const ex = side * 8.5 + fx * 0.6
    const ey = cy - 3.5
    if (!low) {
      ctx.beginPath()
      ctx.ellipse(ex, ey, 5.8 * k, 5.6, 0, 0, Math.PI * 2)
      ctx.fillStyle = C.ring
      ctx.fill()
      ctx.lineWidth = 0.8
      ctx.strokeStyle = 'rgba(74, 59, 42, 0.45)'
      ctx.stroke()
    }
    const er = low ? 4.4 : 3.2
    ctx.beginPath()
    ctx.ellipse(ex, ey, er * k, er * (1 - blink * 0.9), 0, 0, Math.PI * 2)
    ctx.fillStyle = low ? '#fbfbfd' : '#fdfdfd'
    ctx.fill()
    if (blink < 0.6) {
      ctx.beginPath()
      ctx.ellipse(ex + turn * 0.8, ey, (low ? 2.8 : 2.5) * k, (low ? 2.9 : 2.6) * (1 - blink), 0, 0, Math.PI * 2)
      ctx.fillStyle = C.eye
      ctx.fill()
      if (!low) {
        ctx.beginPath()
        ctx.arc(ex + turn * 0.8 + 0.9, ey - 1, 0.8, 0, Math.PI * 2)
        ctx.fillStyle = '#fff'
        ctx.fill()
      }
    }
  }

  // 彎彎的喙，尖端朝下；轉頭時只稍微偏過去，偏太多看起來像喙在臉上滑動
  ctx.save()
  ctx.translate(fx * 0.35, 0)
  ctx.rotate(turn * 0.05)
  // 喙縮小，以上緣中心為基準，才不會擋到兩側的眼睛
  ctx.translate(0, cy - 4)
  ctx.scale(0.62, 0.8)
  ctx.translate(0, -(cy - 4))
  if (!low) {
    // 眉心的紅色斑，貼在喙的正上方，跟著喙一起動
    ctx.beginPath()
    // 沿著喙上緣的曲線描粗線，下半截會被後面畫的喙蓋住，所以上緣完全貼齊
    ctx.moveTo(-6, cy - 4)
    ctx.quadraticCurveTo(0, cy - 7.5, 6, cy - 4)
    ctx.lineWidth = 6.5
    ctx.strokeStyle = C.brow
    ctx.stroke()
  }
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

    // 小小的鼻孔，開在喙的左右上角（跟真的綠頰鸚哥一樣）；這裡有縮放，半徑先除回去才會是圓的
    ctx.fillStyle = '#8a6a66'
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.ellipse(side * 3.9, cy - 2.6, 0.9 / 0.62, 0.9 / 0.8, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()

  // 節日的帽子：戴在頭頂，跟著轉頭稍微偏
  if (o.hat && window.HolidayArt) window.HolidayArt.drawHat(ctx, o.hat, fx * 0.4, cy - r + 4, 26)
  ctx.restore()
}

/** 負載太高時頭旁邊冒汗滴，一滴一滴往下滑。 */
function drawSweat(ctx, heat, time) {
  ctx.save()
  const n = heat > 0.7 ? 2 : 1
  for (let i = 0; i < n; i++) {
    const t = (time * 0.0012 + i * 0.5) % 1
    const side = i === 0 ? 1 : -1
    const x = side * (20 + t * 3)
    const y = -62 + t * 16
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

const boundsCache = {}

/** 把搖到兩側和正中間的樣子疊起來求外框，圖示這樣置中、縮放後搖頭才不會被切到。 */
function artBounds(detail) {
  if (boundsCache[detail]) return boundsCache[detail]

  const S = 4
  const W = 160 * S
  const H = 140 * S
  const ox = W / 2
  const oy = H * 0.75
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
