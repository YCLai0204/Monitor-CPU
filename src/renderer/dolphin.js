'use strict'

/**
 * 台灣白海豚（Q 版、側面）：台灣特有亞種，住在西海岸的淺海。
 * 粉紅色的身體上有灰色的斑點（台灣的亞種連背鰭上都有斑），肚子顏色比較淡，
 * 細長的嘴、圓圓的額頭（額隆），背鰭長在微微隆起的背上，頭頂有噴氣孔。
 * 跟其他吉祥物一樣是用 Canvas 即時畫出來的，沒有圖檔。
 *
 * 座標原點放在「肚子底部中心」，往上是負的；預設面向右邊，dir = -1 時左右翻過來。
 * 動作用的是 app.js 的 'swim'（aquatic：一直待在水裡），這支只依 pose 畫出姿勢：
 *   'swim'   游泳：尾鰭上下擺
 *   'leap'   跳出水面：一樣擺尾，身體的角度由 tilt 決定
 *   'held'   被抓起來：尾鰭亂拍、身體扭來扭去
 *   'icon'   圖示用的姿勢（頭朝上斜斜的，像跳起來）
 * tilt 是身體的角度（弧度，正的是頭朝下），flinch（0..1）是被戳到嚇一跳。
 * 噴氣孔噴出來的水花是 app.js 的粒子（spout），位置在 BLOWHOLE。
 *
 * 包在 IIFE 裡的理由同 crab.js：幾支 <script> 共用全域範圍，避免同名變數衝突。
 */
;(function () {
const C = {
  back: '#e3a0a6',
  mid: '#f2c2c2',
  belly: '#fdeae6',
  outline: '#7a4650',
  spot: 'rgba(110, 112, 128, 0.5)',
  fin: '#dc979e',
  eye: '#231a1d',
  blush: 'rgba(255, 90, 120, 0.6)',
  mouth: '#8a3d4a',
}

const CENTER_Y = -16 // 身體中心的高度，轉角度（tilt）時繞這裡轉

function drawDolphin(ctx, opts) {
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
  let fluke = Math.sin(phase) * 0.3
  if (pose === 'held') {
    angle = Math.sin(time * 0.01) * 0.2
    fluke = Math.sin(time * 0.03) * 0.55
  } else if (pose === 'icon') {
    angle = -0.5
    fluke = 0.25
  }

  ctx.translate(0, CENTER_Y)
  ctx.rotate(angle)
  ctx.translate(0, -CENTER_Y)

  drawFluke(ctx, fluke, low)
  drawDorsal(ctx, low)
  drawBody(ctx, low)
  drawFlipper(ctx, phase, low)
  drawFace(ctx, { blink, heat, flinch, low, open: pose === 'held' })
  ctx.restore()
}

/** 身體加嘴巴：細長的嘴、圓圓的額頭，後面收成細細的尾幹。 */
function bodyPath(ctx) {
  ctx.beginPath()
  ctx.moveTo(50, -9)
  ctx.quadraticCurveTo(45, -12.5, 39, -13.5)
  ctx.bezierCurveTo(39, -27, 28, -33, 12, -33)
  ctx.bezierCurveTo(-6, -33, -26, -24, -38, -15.5)
  ctx.lineTo(-40, -10)
  ctx.bezierCurveTo(-30, -3, -14, 0, 2, 0)
  ctx.bezierCurveTo(18, 0, 31, -2.5, 38, -5.5)
  ctx.quadraticCurveTo(45, -6, 50, -9)
  ctx.closePath()
}

function drawBody(ctx, low) {
  bodyPath(ctx)
  const g = ctx.createLinearGradient(0, -33, 0, 0)
  g.addColorStop(0, C.back)
  g.addColorStop(0.5, C.mid)
  g.addColorStop(0.8, C.belly)
  ctx.fillStyle = g
  ctx.fill()

  if (!low) {
    // 背上的灰斑
    ctx.save()
    bodyPath(ctx)
    ctx.clip()
    ctx.fillStyle = C.spot
    const spots = [[-30, -18, 1.4], [-24, -22, 1.1], [-18, -25, 1.6], [-12, -28, 1], [-8, -23.5, 1.3], [-2, -29.5, 1.5],
      [3, -25, 1], [8, -30.5, 1.2], [14, -27, 1.4], [20, -30.5, 1], [-15, -19, 1], [-26, -15, 0.9], [26, -26, 1.1]]
    for (const [x, y, r] of spots) {
      ctx.beginPath()
      ctx.ellipse(x, y, r * 1.3, r, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  bodyPath(ctx)
  ctx.lineWidth = low ? 2.6 : 1.6
  ctx.strokeStyle = C.outline
  ctx.stroke()

  if (!low) {
    // 噴氣孔
    ctx.beginPath()
    ctx.moveTo(BLOWHOLE.x - 2, BLOWHOLE.y + 0.8)
    ctx.quadraticCurveTo(BLOWHOLE.x, BLOWHOLE.y + 2, BLOWHOLE.x + 2, BLOWHOLE.y + 0.8)
    ctx.lineWidth = 1
    ctx.strokeStyle = C.outline
    ctx.stroke()
  }
}

const BLOWHOLE = { x: 17, y: -32.5 }

/** 背鰭：三角形、往後彎，台灣的亞種上面也有斑。 */
function drawDorsal(ctx, low) {
  ctx.beginPath()
  ctx.moveTo(-13, -30)
  ctx.quadraticCurveTo(-10, -39, -3, -44)
  ctx.quadraticCurveTo(-2, -37, 4, -32.5)
  ctx.closePath()
  ctx.fillStyle = C.fin
  ctx.fill()
  if (!low) {
    ctx.fillStyle = C.spot
    for (const [x, y] of [[-7, -35], [-4, -39.5], [-2, -33.5]]) {
      ctx.beginPath()
      ctx.arc(x, y, 1.1, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.lineWidth = low ? 2.4 : 1.5
  ctx.strokeStyle = C.outline
  ctx.stroke()
}

/**
 * 尾鰭：海豚的尾鰭是水平的（魚的尾鰭才是直的），側面看是一片往後伸的扁葉子，
 * 遠的那一片從後面露出一點。繞著尾幹上下擺。
 */
function drawFluke(ctx, swing, low) {
  ctx.save()
  ctx.translate(-39, -12.5)
  ctx.rotate(swing)
  ctx.beginPath()
  ctx.moveTo(1, -2.5)
  ctx.quadraticCurveTo(-9, -5.5, -19, -5)
  ctx.quadraticCurveTo(-21.5, -2.5, -18, -0.5)
  ctx.quadraticCurveTo(-21, 2, -17, 3.5)
  ctx.quadraticCurveTo(-8, 3.5, 1, 2.5)
  ctx.closePath()
  ctx.fillStyle = C.fin
  ctx.fill()
  ctx.lineWidth = low ? 2.4 : 1.5
  ctx.strokeStyle = C.outline
  ctx.stroke()
  ctx.restore()
}

/** 胸鰭：往後下方伸，跟著游泳輕輕擺。 */
function drawFlipper(ctx, phase, low) {
  ctx.save()
  ctx.translate(20, -7)
  ctx.rotate(0.55 + Math.sin(phase * 1.2) * 0.15)
  ctx.beginPath()
  ctx.ellipse(-6.5, 0, 8, 3, 0, 0, Math.PI * 2)
  ctx.fillStyle = C.fin
  ctx.fill()
  ctx.lineWidth = low ? 2.2 : 1.3
  ctx.strokeStyle = C.outline
  ctx.stroke()
  ctx.restore()
}

function drawFace(ctx, { blink, heat, flinch, low, open }) {
  const ex = 31
  const ey = -19
  const er = low ? 3.4 : 2.9
  if (flinch > 0.4 && !low) {
    ctx.beginPath()
    ctx.moveTo(ex - 2.2, ey - 2.2)
    ctx.lineTo(ex + 1.8, ey)
    ctx.lineTo(ex - 2.2, ey + 2.2)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = C.eye
    ctx.stroke()
  } else if (blink > 0.6) {
    ctx.beginPath()
    ctx.moveTo(ex - er, ey)
    ctx.quadraticCurveTo(ex, ey + er * 0.8, ex + er, ey)
    ctx.lineWidth = low ? 1.8 : 1.3
    ctx.strokeStyle = C.eye
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.ellipse(ex, ey, er, er * (1 - blink), 0, 0, Math.PI * 2)
    ctx.fillStyle = C.eye
    ctx.fill()
    if (!low) {
      ctx.beginPath()
      ctx.arc(ex + 0.9, ey - 1, 0.85, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
    }
  }

  // 嘴巴：沿著長嘴的一道微笑；被抓著時張開
  if (open) {
    ctx.beginPath()
    ctx.moveTo(49.5, -9)
    ctx.lineTo(39, -9.5)
    ctx.quadraticCurveTo(43, -5, 48, -7.6)
    ctx.closePath()
    ctx.fillStyle = C.mouth
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.moveTo(49.5, -9)
    ctx.quadraticCurveTo(43, -8.6, 38, -10.2)
    ctx.quadraticCurveTo(36.5, -10.6, 36, -11.8)
    ctx.lineWidth = low ? 1.6 : 1.1
    ctx.strokeStyle = C.outline
    ctx.stroke()
  }

  if (heat > 0 && !low) {
    ctx.beginPath()
    ctx.ellipse(30, -12.5, 3.2, 1.8, 0, 0, Math.PI * 2)
    ctx.globalAlpha = heat
    ctx.fillStyle = C.blush
    ctx.fill()
    ctx.globalAlpha = 1
  }
}

// ---------------------------------------------------------------- 圖示

const iconFit = {}

/** 把牠畫成 size×size 的 PNG data URL；第一次先畫一張量出實際範圍，之後照這個範圍置中放大。 */
function renderIcon(size, detail = size <= 32 ? 'low' : 'high') {
  if (!iconFit[detail]) iconFit[detail] = measure((ctx) => drawDolphin(ctx, { pose: 'icon', detail }))
  return fitIcon(size, iconFit[detail], (ctx, s) => drawDolphin(ctx, { scale: s, pose: 'icon', detail }))
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

window.MascotArt = Object.assign(window.MascotArt || {}, { dolphin: { draw: drawDolphin, renderIcon, blowhole: BLOWHOLE } })
})()
