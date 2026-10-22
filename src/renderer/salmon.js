'use strict'

/**
 * 櫻花鉤吻鮭（Q 版、側面）：台灣特有亞種、國寶魚，只住在大甲溪上游的冷水溪流。
 * 橄欖色的背、銀白色的肚子，身體兩側一排深色的橢圓斑（幼鮭斑，長大了也還在），
 * 中間一條粉紅色的側線（「櫻花」就是指這個顏色），背上有小黑點，背鰭後面有一個小小的脂鰭。
 * 跟其他吉祥物一樣是用 Canvas 即時畫出來的，沒有圖檔。
 *
 * 座標原點放在「肚子底部中心」，往上是負的；預設面向右邊，dir = -1 時左右翻過來。
 * 動作用的是 app.js 的 'swim'（aquatic：一直待在水裡），這支只依 pose 畫出姿勢：
 *   'swim'   游泳：尾巴左右擺（側面看是上下擺動的尾鰭）
 *   'leap'   跳出水面：一樣擺尾，身體的角度由 tilt 決定
 *   'held'   被抓起來：整條魚扭來扭去、嘴巴張開
 *   'icon'   圖示用的姿勢（頭朝上斜斜的，比較好塞進正方形）
 * tilt 是身體的角度（弧度，正的是頭朝下），flinch（0..1）是被戳到嚇一跳。
 *
 * 包在 IIFE 裡的理由同 crab.js：幾支 <script> 共用全域範圍，避免同名變數衝突。
 */
;(function () {
const C = {
  back: '#6d7d58',
  mid: '#a3ad8c',
  belly: '#eef1ee',
  outline: '#33402c',
  pink: 'rgba(236, 128, 158, 0.85)',
  parr: 'rgba(58, 72, 56, 0.55)',
  dot: '#2f3a2a',
  fin: '#8b9670',
  finEdge: '#55603f',
  eye: '#161a14',
  blush: 'rgba(255, 110, 130, 0.7)',
  mouth: '#7a3c40',
}

const CENTER_Y = -12 // 身體中心的高度，轉角度（tilt）時繞這裡轉

function drawSalmon(ctx, opts) {
  const {
    scale = 1,
    dir = 1,
    phase = 0,
    pose = 'swim',
    tilt = 0,
    flinch = 0,
    heat = 0,
    blink = 0,
    detail = 'high',
    time = 0,
  } = opts
  const low = detail === 'low'

  ctx.save()
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.scale(dir < 0 ? -1 : 1, 1)

  let angle = tilt
  let tail = Math.sin(phase) * 0.32
  if (pose === 'held') {
    // 被抓著：整條魚扭來扭去
    angle = Math.sin(time * 0.012) * 0.25
    tail = Math.sin(time * 0.035) * 0.6
  } else if (pose === 'icon') {
    angle = -0.42
    tail = 0.15
  }

  ctx.translate(0, CENTER_Y)
  ctx.rotate(angle)
  ctx.translate(0, -CENTER_Y)

  drawTail(ctx, tail, low)
  drawFins(ctx, phase, low, 'back')
  drawBody(ctx, low)
  drawFins(ctx, phase, low, 'front')
  drawFace(ctx, { blink, heat, flinch, low, open: pose === 'held' })
  ctx.restore()
}

/** 身體（不含尾鰭）：圓圓胖胖的紡錘形，尾柄收得細細的。 */
function bodyPath(ctx) {
  ctx.beginPath()
  ctx.moveTo(31, -11)
  ctx.bezierCurveTo(28, -20, 15, -25, -2, -24)
  ctx.bezierCurveTo(-14, -23.5, -22, -18, -27, -13.5)
  ctx.lineTo(-27, -7)
  ctx.bezierCurveTo(-22, -3, -12, 0, 0, 0)
  ctx.bezierCurveTo(14, 0, 26, -3, 30.5, -8.5)
  ctx.quadraticCurveTo(31.5, -10, 31, -11)
  ctx.closePath()
}

function drawBody(ctx, low) {
  bodyPath(ctx)
  const g = ctx.createLinearGradient(0, -24, 0, 0)
  g.addColorStop(0, C.back)
  g.addColorStop(0.45, C.mid)
  g.addColorStop(0.62, C.belly)
  g.addColorStop(1, C.belly)
  ctx.fillStyle = g
  ctx.fill()

  ctx.save()
  bodyPath(ctx)
  ctx.clip()
  // 粉紅色的側線：從鰓蓋後面一路到尾柄
  ctx.beginPath()
  ctx.moveTo(18, -12.5)
  ctx.bezierCurveTo(6, -13.5, -12, -13, -28, -10.5)
  ctx.lineWidth = low ? 4.5 : 3.6
  ctx.strokeStyle = C.pink
  ctx.stroke()
  // 幼鮭斑：沿著側線一排直直的深色橢圓
  ctx.fillStyle = C.parr
  const marks = low ? [-15, -5, 5] : [-20, -13.5, -7, -0.5, 6, 12]
  for (const x of marks) {
    ctx.beginPath()
    ctx.ellipse(x, -13, low ? 3 : 2.3, low ? 5 : 4.4, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  if (!low) {
    // 背上的小黑點
    ctx.fillStyle = C.dot
    for (const [x, y] of [[-14, -20], [-7, -21.5], [1, -22], [9, -21], [-19, -17], [5, -19]]) {
      ctx.beginPath()
      ctx.arc(x, y, 0.75, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()

  bodyPath(ctx)
  ctx.lineWidth = low ? 2.4 : 1.5
  ctx.strokeStyle = C.outline
  ctx.stroke()

  if (!low) {
    // 鰓蓋
    ctx.beginPath()
    ctx.moveTo(16, -19)
    ctx.quadraticCurveTo(12, -12, 16, -5)
    ctx.lineWidth = 1.1
    ctx.strokeStyle = 'rgba(51, 64, 44, 0.6)'
    ctx.stroke()
  }
}

/** 尾鰭：繞著尾柄轉，擺動的角度是 swing。 */
function drawTail(ctx, swing, low) {
  ctx.save()
  ctx.translate(-26, -10.25)
  ctx.rotate(swing)
  ctx.beginPath()
  ctx.moveTo(0, -3.5)
  ctx.quadraticCurveTo(-8, -6, -15, -10)
  ctx.quadraticCurveTo(-11.5, 0, -15, 9.5)
  ctx.quadraticCurveTo(-8, 5.5, 0, 3.5)
  ctx.closePath()
  ctx.fillStyle = C.fin
  ctx.fill()
  ctx.lineWidth = low ? 2.2 : 1.4
  ctx.strokeStyle = C.outline
  ctx.stroke()
  if (!low) {
    ctx.beginPath()
    for (const y of [-5, 0, 5]) {
      ctx.moveTo(-2, y * 0.35)
      ctx.lineTo(-12, y * 1.4)
    }
    ctx.lineWidth = 0.7
    ctx.strokeStyle = C.finEdge
    ctx.stroke()
  }
  ctx.restore()
}

/** 鰭：which = 'back' 畫在身體後面（背鰭、脂鰭、臀鰭），'front' 畫在身體前面（胸鰭、腹鰭）。 */
function drawFins(ctx, phase, low, which) {
  const fin = (draw) => {
    ctx.beginPath()
    draw()
    ctx.fillStyle = C.fin
    ctx.fill()
    ctx.lineWidth = low ? 2 : 1.2
    ctx.strokeStyle = C.outline
    ctx.stroke()
  }
  if (which === 'back') {
    // 背鰭
    fin(() => {
      ctx.moveTo(-9, -23)
      ctx.quadraticCurveTo(-7, -31, -2.5, -32)
      ctx.quadraticCurveTo(0, -27, 1.5, -23.5)
      ctx.closePath()
    })
    // 脂鰭：背鰭和尾巴中間的小肉鰭（鮭魚的特徵）
    if (!low) {
      fin(() => {
        ctx.moveTo(-21, -17.5)
        ctx.quadraticCurveTo(-21, -21.5, -17.5, -21)
        ctx.quadraticCurveTo(-17.5, -19.5, -17, -19)
        ctx.closePath()
      })
    }
    // 臀鰭
    fin(() => {
      ctx.moveTo(-15, -3)
      ctx.quadraticCurveTo(-18, 2, -21, 1.5)
      ctx.quadraticCurveTo(-21, -2, -20.5, -5)
      ctx.closePath()
    })
    return
  }
  // 胸鰭：跟著游泳輕輕擺
  const a = 0.5 + Math.sin(phase * 1.3) * 0.18
  ctx.save()
  ctx.translate(14, -6)
  ctx.rotate(a)
  fin(() => ctx.ellipse(-5, 0, 6, 2.4, 0, 0, Math.PI * 2))
  ctx.restore()
  // 腹鰭
  fin(() => {
    ctx.moveTo(-3, -1)
    ctx.quadraticCurveTo(-6, 3.5, -9.5, 3)
    ctx.quadraticCurveTo(-8.5, 0, -8, -1.5)
    ctx.closePath()
  })
}

function drawFace(ctx, { blink, heat, flinch, low, open }) {
  const ex = 22
  const ey = -15
  const er = low ? 3.6 : 3.2
  if (flinch > 0.4 && !low) {
    // 嚇一跳：眼睛擠成 > <
    ctx.beginPath()
    ctx.moveTo(ex - 2.4, ey - 2.4)
    ctx.lineTo(ex + 1.8, ey)
    ctx.lineTo(ex - 2.4, ey + 2.4)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = C.eye
    ctx.stroke()
  } else {
    // 魚沒有眼皮，但 Q 版還是讓牠眨眼
    ctx.beginPath()
    ctx.ellipse(ex, ey, er, er * (1 - blink * 0.85), 0, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(ex + 0.6, ey, er * 0.66, er * 0.7 * (1 - blink * 0.85), 0, 0, Math.PI * 2)
    ctx.fillStyle = C.eye
    ctx.fill()
    if (!low && blink < 0.5) {
      ctx.beginPath()
      ctx.arc(ex + 1.5, ey - 1, 0.8, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
    }
  }

  // 嘴巴：鮭魚的嘴角開到眼睛下面；被抓著時張開
  ctx.beginPath()
  if (open) {
    ctx.ellipse(29, -9, 2, 1.6, 0, 0, Math.PI * 2)
    ctx.fillStyle = C.mouth
    ctx.fill()
  } else {
    ctx.moveTo(30.5, -9.5)
    ctx.quadraticCurveTo(27, -8.5, 24.5, -9.5)
    ctx.lineWidth = low ? 1.6 : 1.1
    ctx.strokeStyle = C.outline
    ctx.stroke()
  }

  if (heat > 0 && !low) {
    ctx.beginPath()
    ctx.ellipse(21, -9, 3, 1.8, 0, 0, Math.PI * 2)
    ctx.globalAlpha = heat
    ctx.fillStyle = C.blush
    ctx.fill()
    ctx.globalAlpha = 1
  }
}

// ---------------------------------------------------------------- 魚卵（彩蛋）

/**
 * 一顆鮭魚卵：半透明的橘色小球，裡面看得到小魚的兩個黑眼點（發眼卵）。原點是卵的底部中心。
 * crack（0..1）是孵化進行到哪：一開始晃、出現裂痕，最後裂成上下兩半。
 */
function drawEgg(ctx, { scale = 1, time = 0, crack = 0 } = {}) {
  const R = 6
  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(0, -R)
  if (crack > 0) ctx.rotate(Math.sin(time * 0.03) * 0.3 * Math.min(1, crack * 2))
  const shell = (from, to) => {
    ctx.beginPath()
    ctx.arc(0, 0, R, from, to)
    ctx.closePath()
    const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, R)
    g.addColorStop(0, '#ffe0b8')
    g.addColorStop(0.55, '#ff9d4f')
    g.addColorStop(1, '#e4682c')
    ctx.globalAlpha = 0.95
    ctx.fillStyle = g
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.lineWidth = 0.9
    ctx.strokeStyle = '#b4521f'
    ctx.stroke()
  }
  if (crack < 0.85) {
    shell(0, Math.PI * 2)
    // 小魚的兩個眼點和捲著的身體
    ctx.fillStyle = 'rgba(40, 26, 18, 0.85)'
    ctx.beginPath()
    ctx.arc(1, 0.8, 0.95, 0, Math.PI * 2)
    ctx.arc(2.9, 0.3, 0.85, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(0.5, 0.5, 3.3, Math.PI * 0.2, Math.PI * 1.3)
    ctx.lineWidth = 0.7
    ctx.strokeStyle = 'rgba(150, 70, 30, 0.6)'
    ctx.stroke()
    // 反光
    ctx.beginPath()
    ctx.arc(-2.3, -2.4, 1.3, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.fill()
    if (crack > 0.3) {
      // 裂痕
      ctx.beginPath()
      ctx.moveTo(-R, -0.5)
      ctx.lineTo(-3, 0.8)
      ctx.lineTo(-1, -0.8)
      ctx.lineTo(1.5, 0.9)
      ctx.lineTo(3.5, -0.6)
      ctx.lineTo(R, 0.4)
      ctx.globalAlpha = Math.min(1, (crack - 0.3) * 3)
      ctx.lineWidth = 0.8
      ctx.strokeStyle = '#7a3412'
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  } else {
    // 裂成兩半：上半邊往上翻開
    const d = ((crack - 0.85) / 0.15) * 4
    shell(0, Math.PI)
    ctx.save()
    ctx.translate(-1, -d)
    ctx.rotate(-d * 0.15)
    shell(Math.PI, Math.PI * 2)
    ctx.restore()
  }
  ctx.restore()
}

// ---------------------------------------------------------------- 圖示

const iconFit = {}

/** 把牠畫成 size×size 的 PNG data URL；第一次先畫一張量出實際範圍，之後照這個範圍置中放大。 */
function renderIcon(size, detail = size <= 32 ? 'low' : 'high') {
  if (!iconFit[detail]) iconFit[detail] = measure((ctx) => drawSalmon(ctx, { pose: 'icon', detail }))
  return fitIcon(size, iconFit[detail], (ctx, s) => drawSalmon(ctx, { scale: s, pose: 'icon', detail }))
}

/** 在 200×200 的畫布中央畫一次，掃出不透明的範圍（scale = 1 的座標）。 */
function measure(draw) {
  const c = document.createElement('canvas')
  c.width = 200
  c.height = 200
  const ctx = c.getContext('2d')
  ctx.translate(100, 100)
  draw(ctx)
  const data = ctx.getImageData(0, 0, 200, 200).data
  let l = 200, r = 0, t = 200, b = 0
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 200; x++) {
      if (data[(y * 200 + x) * 4 + 3] > 8) {
        if (x < l) l = x
        if (x > r) r = x
        if (y < t) t = y
        if (y > b) b = y
      }
    }
  }
  return { left: l - 100, right: r - 99, top: t - 100, bottom: b - 99 }
}

function fitIcon(size, b, draw) {
  const pad = size <= 32 ? 0.5 : size * 0.04
  const s = (size - pad * 2) / Math.max(b.right - b.left, b.bottom - b.top)
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  ctx.translate(size / 2 - ((b.left + b.right) / 2) * s, size / 2 - ((b.top + b.bottom) / 2) * s)
  draw(ctx, s)
  return c.toDataURL('image/png')
}

window.MascotArt = Object.assign(window.MascotArt || {}, { salmon: { draw: drawSalmon, drawEgg, renderIcon } })
})()
