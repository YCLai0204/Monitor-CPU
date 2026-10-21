'use strict'

/**
 * 綠蠵龜（Q 版、側面）：橄欖褐色的背甲上有放射狀的紋路、米黃色的腹甲、
 * 頭上一塊塊淺色的鱗片、長長的槳狀前鰭肢。跟其他吉祥物一樣是用 Canvas 即時畫出來的，沒有圖檔。
 *
 * 座標原點放在「腹甲底部中心」，往上是負的；預設面向右邊，dir = -1 時左右翻過來。
 * 動作用的是 app.js 的 'swim'，這支只依 pose 畫出姿勢：
 *   'land'   在岸上爬：前鰭肢一起往後撐地，身體跟著一撐一撐往前
 *   'swim'   游泳：前鰭肢像翅膀一樣上下划
 *   'held'   被抓起來：四隻鰭肢亂划
 *   'icon'   圖示用的姿勢
 *
 * 另外畫淺水（drawWaterBack 在烏龜後面、drawWaterFront 蓋在烏龜前面）與水花、泡泡、漣漪（drawParticles）。
 * 海龜不能把頭縮進殼裡（陸龜才可以），所以被戳到時只會嚇一跳，不會縮頭。
 *
 * 包在 IIFE 裡的理由同 crab.js：幾支 <script> 共用全域範圍，避免同名變數衝突。
 */
;(function () {
const C = {
  outline: '#3b3a22',
  shell: '#6f7a3c',
  shellHi: '#a39a5a',
  shellDark: '#4d5628',
  scuteLine: '#3f4520',
  streak: 'rgba(214, 190, 120, 0.55)',
  rim: '#8b8a4a',
  plastron: '#e9dba4',
  skin: '#8fa159',
  skinDark: '#66783a',
  scale: '#c6c98a',
  eye: '#1b1c16',
  blush: 'rgba(255, 120, 120, 0.7)',
}

function drawTurtle(ctx, opts) {
  const {
    scale = 1,
    dir = 1,
    phase = 0,
    pose = 'land',
    tilt = 0,
    flinch = 0,     // 0..1，被戳到嚇一跳：頭往後縮一點、鰭肢縮起來（不是縮進殼裡）
    heat = 0,
    blink = 0,
    detail = 'high',
    shadow = true,
    time = 0,
  } = opts

  const low = detail === 'low'
  const lw = low ? 2.2 : 1.3

  ctx.save()
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (shadow && pose === 'land') {
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(0, 1, 30, 3.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  ctx.scale(dir < 0 ? -1 : 1, 1)

  // 在岸上爬時，每撐一下身體往上抬一點
  const push = pose === 'land' ? Math.max(0, Math.sin(phase)) : 0
  ctx.translate(0, -push * 2)
  ctx.translate(0, -12)
  ctx.rotate(tilt)
  ctx.translate(0, 12)

  const front = flipperAngle(pose, phase, time, 0)
  const back = flipperAngle(pose, phase, time, 1)

  // 遠的那一側（較暗）先畫在殼後面
  drawFlipper(ctx, 12, -8, front.far, 23 * (1 - flinch * 0.4), true, low)
  drawRearFlipper(ctx, -21, -5, back.far, true, low)
  drawHead(ctx, { phase, pose, flinch, blink, heat, low, lw })
  drawShell(ctx, low, lw)
  drawRearFlipper(ctx, -19, -3, back.near, false, low)
  drawFlipper(ctx, 14, -6, front.near, 25 * (1 - flinch * 0.4), false, low)
  if (heat > 0.35 && !low && pose !== 'icon') drawSweat(ctx, heat, time)

  ctx.restore()
}

/** 前鰭肢與後鰭肢的角度（0 = 水平往後，正的往下）。 */
function flipperAngle(pose, phase, time, which) {
  if (pose === 'swim') {
    // 像翅膀一樣上下划；後鰭肢只是跟著擺
    const s = Math.sin(phase)
    return which === 0 ? { near: 0.15 + s * 0.8, far: 0.05 + s * 0.7 } : { near: 0.3 + s * 0.15, far: 0.25 + s * 0.12 }
  }
  if (pose === 'held') {
    const s = Math.sin(time * 0.03)
    return which === 0 ? { near: 0.3 + s * 0.9, far: 0.2 - s * 0.8 } : { near: 0.5 + s * 0.4, far: 0.4 - s * 0.4 }
  }
  if (pose === 'icon') return which === 0 ? { near: 0.55, far: 0.45 } : { near: 0.6, far: 0.55 }
  // 在岸上：兩隻前鰭肢一起往下撐地、往後推
  const s = Math.sin(phase)
  return which === 0 ? { near: 0.75 + s * 0.4, far: 0.7 + s * 0.4 } : { near: 0.75, far: 0.7 }
}

/** 槳狀的前鰭肢：(x, y) 是根部，往後方（尾巴那邊）伸出去，angle 正的往下划、負的往上。 */
function drawFlipper(ctx, x, y, angle, len, far, low) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(-1, 1)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(-2, -3.5)
  ctx.quadraticCurveTo(len * 0.35, -6, len * 0.7, -3)
  ctx.quadraticCurveTo(len * 1.02, -0.5, len * 0.95, 1.5)
  ctx.quadraticCurveTo(len * 0.5, 4.5, -2, 3.5)
  ctx.closePath()
  ctx.fillStyle = far ? C.skinDark : C.skin
  ctx.fill()
  ctx.lineWidth = low ? 2 : 1.1
  ctx.strokeStyle = C.outline
  ctx.stroke()
  if (!low && !far) {
    // 鰭肢前緣的鱗片
    ctx.fillStyle = C.scale
    for (const t of [0.25, 0.5, 0.72]) {
      ctx.beginPath()
      ctx.ellipse(len * t, -2.6, 2.4, 1.3, 0.05, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

function drawRearFlipper(ctx, x, y, angle, far, low) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(-1, 1)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.ellipse(6, 0, 8, 3.6, 0.1, 0, Math.PI * 2)
  ctx.fillStyle = far ? C.skinDark : C.skin
  ctx.fill()
  ctx.lineWidth = low ? 2 : 1.1
  ctx.strokeStyle = C.outline
  ctx.stroke()
  ctx.restore()
}

function shellPath(ctx) {
  ctx.beginPath()
  ctx.moveTo(-29, -4)
  ctx.bezierCurveTo(-27, -21, -10, -27, 1, -27)
  ctx.bezierCurveTo(13, -27, 25, -20, 27, -6)
  ctx.quadraticCurveTo(27, -2, 22, -2)
  ctx.lineTo(-25, -2)
  ctx.quadraticCurveTo(-30, -2, -29, -4)
  ctx.closePath()
}

function drawShell(ctx, low, lw) {
  // 腹甲：殼下面露出一條米黃色
  ctx.beginPath()
  ctx.moveTo(-25, -4)
  ctx.lineTo(22, -4)
  ctx.quadraticCurveTo(24, 0, 18, 0)
  ctx.lineTo(-21, 0)
  ctx.quadraticCurveTo(-26, 0, -25, -4)
  ctx.closePath()
  ctx.fillStyle = C.plastron
  ctx.fill()
  ctx.lineWidth = lw
  ctx.strokeStyle = C.outline
  ctx.stroke()

  // 背甲
  const g = ctx.createLinearGradient(0, -27, 0, -2)
  g.addColorStop(0, C.shellHi)
  g.addColorStop(0.45, C.shell)
  g.addColorStop(1, C.shellDark)
  shellPath(ctx)
  ctx.fillStyle = g
  ctx.fill()
  if (!low) {
    ctx.save()
    shellPath(ctx)
    ctx.clip()
    // 綠蠵龜背甲上的放射狀紋路
    ctx.strokeStyle = C.streak
    ctx.lineWidth = 1.1
    for (const [cx, cy] of [[-14, -14], [0, -18], [14, -14]]) {
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k - 2) * 0.45
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9)
        ctx.stroke()
      }
    }
    // 盾片的分界
    ctx.strokeStyle = C.scuteLine
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(-7, -26)
    ctx.lineTo(-7, -9)
    ctx.moveTo(7, -26)
    ctx.lineTo(7, -9)
    ctx.moveTo(-28, -9)
    ctx.quadraticCurveTo(0, -12, 27, -9)
    ctx.stroke()
    // 邊緣一圈小盾片
    ctx.strokeStyle = C.rim
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.moveTo(-28, -5)
    ctx.quadraticCurveTo(0, -8, 26, -5)
    ctx.stroke()
    ctx.restore()
  }
  shellPath(ctx)
  ctx.lineWidth = lw
  ctx.strokeStyle = C.outline
  ctx.stroke()
}

function drawHead(ctx, { phase, pose, flinch, blink, heat, low, lw }) {
  const bob = pose === 'land' ? Math.sin(phase) * 1.2 : Math.sin(phase * 0.5) * 0.8
  const hx = 34 - flinch * 5
  const hy = -12 + bob
  // 脖子
  ctx.beginPath()
  ctx.moveTo(20, -13)
  ctx.quadraticCurveTo(27, -14 + bob * 0.5, hx - 4, hy)
  ctx.lineWidth = low ? 9 : 8
  ctx.strokeStyle = C.skin
  ctx.stroke()
  // 頭
  ctx.beginPath()
  ctx.ellipse(hx, hy, 9, 7.2, 0.05, 0, Math.PI * 2)
  ctx.fillStyle = C.skin
  ctx.fill()
  ctx.lineWidth = lw
  ctx.strokeStyle = C.outline
  ctx.stroke()
  if (!low) {
    // 頭上一塊塊淺色的鱗片
    ctx.fillStyle = C.scale
    for (const [dx, dy, rx, ry] of [[-2, -4, 3, 2], [2.5, -4.5, 2.4, 1.7], [-4, 0.5, 2.2, 1.8]]) {
      ctx.beginPath()
      ctx.ellipse(hx + dx, hy + dy, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // 眼睛
  const ex = hx + 3
  const ey = hy - 1.5
  ctx.beginPath()
  ctx.ellipse(ex, ey, low ? 2.6 : 2.3, (low ? 2.6 : 2.3) * (1 - blink * 0.9), 0, 0, Math.PI * 2)
  ctx.fillStyle = C.eye
  ctx.fill()
  if (!low && blink < 0.6) {
    ctx.beginPath()
    ctx.arc(ex + 0.7, ey - 0.8, 0.7, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.fill()
  }
  if (!low) {
    // 嘴
    ctx.beginPath()
    ctx.moveTo(hx + 4, hy + 3)
    ctx.quadraticCurveTo(hx + 7, hy + 3.5, hx + 8.5, hy + 1.5)
    ctx.lineWidth = 1
    ctx.strokeStyle = C.outline
    ctx.stroke()
  }
  if (heat > 0 && !low) {
    ctx.beginPath()
    ctx.ellipse(hx + 1, hy + 2.5, 2.6, 1.6, 0, 0, Math.PI * 2)
    ctx.globalAlpha = heat
    ctx.fillStyle = C.blush
    ctx.fill()
    ctx.globalAlpha = 1
  }
}

function drawSweat(ctx, heat, time) {
  ctx.save()
  const t = (time * 0.0012) % 1
  ctx.globalAlpha = Math.min(1, (1 - t) * 1.6) * Math.min(1, (heat - 0.35) * 3)
  const x = 30 - t * 3
  const y = -28 + t * 10
  ctx.beginPath()
  ctx.moveTo(x, y - 5)
  ctx.quadraticCurveTo(x + 3.2, y + 0.5, x, y + 2.5)
  ctx.quadraticCurveTo(x - 3.2, y + 0.5, x, y - 5)
  ctx.fillStyle = '#8fd3ff'
  ctx.fill()
  ctx.restore()
}

// ---------------------------------------------------------------- 淺水

/** 水面在 x 這個位置的高度（相對 surfaceY），兩道波疊在一起才不會太規律。 */
function waveY(x, t, s) {
  return (Math.sin(x * 0.045 / s + t * 2.1) * 1.6 + Math.sin(x * 0.11 / s - t * 3.3) * 0.8) * s
}

/** 左右兩端淡出的顏色漸層。 */
function fadeGradient(ctx, x, width, rgb, alpha) {
  const g = ctx.createLinearGradient(x - width / 2, 0, x + width / 2, 0)
  g.addColorStop(0, `rgba(${rgb}, 0)`)
  g.addColorStop(0.18, `rgba(${rgb}, ${alpha})`)
  g.addColorStop(0.82, `rgba(${rgb}, ${alpha})`)
  g.addColorStop(1, `rgba(${rgb}, 0)`)
  return g
}

function waterPath(ctx, x, width, surfaceY, groundY, t, s) {
  const left = x - width / 2
  ctx.beginPath()
  ctx.moveTo(left, groundY)
  for (let px = 0; px <= width; px += 6) ctx.lineTo(left + px, surfaceY + waveY(left + px, t, s))
  ctx.lineTo(left + width, groundY)
  ctx.closePath()
}

/** 烏龜後面的水：水體本身。amount 是 0..1，下水、上岸時淡入淡出。 */
function drawWaterBack(ctx, { x, width, surfaceY, groundY, amount, time, scale = 1 }) {
  if (amount <= 0.01) return
  const t = time / 1000
  ctx.save()
  ctx.globalAlpha = amount
  waterPath(ctx, x, width, surfaceY, groundY, t, scale)
  ctx.fillStyle = fadeGradient(ctx, x, width, '64, 150, 200', 0.5)
  ctx.fill()
  // 水底的沙
  ctx.fillStyle = fadeGradient(ctx, x, width, '226, 205, 150', 0.5)
  ctx.fillRect(x - width / 2, groundY - 3 * scale, width, 3 * scale)
  ctx.restore()
}

/** 蓋在烏龜前面的水：讓泡在水裡的那半截看起來在水裡，再畫上水面的線和反光。 */
function drawWaterFront(ctx, { x, width, surfaceY, groundY, amount, time, scale = 1 }) {
  if (amount <= 0.01) return
  const t = time / 1000
  const left = x - width / 2
  ctx.save()
  ctx.globalAlpha = amount
  waterPath(ctx, x, width, surfaceY, groundY, t, scale)
  ctx.fillStyle = fadeGradient(ctx, x, width, '90, 175, 220', 0.36)
  ctx.fill()
  // 水面的線
  ctx.beginPath()
  for (let px = 0; px <= width; px += 6) {
    const y = surfaceY + waveY(left + px, t, scale)
    if (px === 0) ctx.moveTo(left, y)
    else ctx.lineTo(left + px, y)
  }
  ctx.lineWidth = 1.6 * scale
  ctx.strokeStyle = fadeGradient(ctx, x, width, '235, 250, 255', 0.85)
  ctx.stroke()
  // 水面上一閃一閃的反光，往前流動
  ctx.lineWidth = 1.2 * scale
  for (let i = 0; i < 5; i++) {
    const u = ((t * 0.12 + i / 5) % 1)
    const hx = left + width * (0.12 + u * 0.76)
    const hy = surfaceY + waveY(hx, t, scale) + 4 * scale
    ctx.globalAlpha = amount * Math.sin(u * Math.PI) * 0.7
    ctx.beginPath()
    ctx.moveTo(hx - 5 * scale, hy)
    ctx.lineTo(hx + 5 * scale, hy)
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * 粒子：{ kind: 'drop' 水花 | 'bubble' 泡泡 | 'ripple' 漣漪 | 'dust' 沙, x, y, r, life（0..1，剩下多少）}。
 * 位置是視窗座標，app.js 負責移動，這裡只負責畫。
 */
function drawParticles(ctx, particles, scale = 1) {
  ctx.save()
  for (const p of particles) {
    const a = Math.max(0, Math.min(1, p.life))
    if (p.kind === 'ripple') {
      ctx.globalAlpha = a * 0.8
      ctx.beginPath()
      ctx.ellipse(p.x, p.y, p.r, p.r * 0.28, 0, 0, Math.PI * 2)
      ctx.lineWidth = 1.2 * scale
      ctx.strokeStyle = '#eefaff'
      ctx.stroke()
    } else if (p.kind === 'bubble') {
      ctx.globalAlpha = a * 0.8
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.lineWidth = 1 * scale
      ctx.strokeStyle = '#dff4ff'
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.3, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
    } else if (p.kind === 'dust') {
      ctx.globalAlpha = a * 0.5
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fillStyle = '#d9c9a3'
      ctx.fill()
    } else {
      ctx.globalAlpha = a
      ctx.beginPath()
      ctx.ellipse(p.x, p.y, p.r * 0.75, p.r, Math.atan2(p.vy || 1, p.vx || 0) - Math.PI / 2, 0, Math.PI * 2)
      ctx.fillStyle = '#bfe8ff'
      ctx.fill()
    }
  }
  ctx.restore()
}

// ---------------------------------------------------------------- 圖示

const ICON_BOUNDS = { left: -31, right: 44, top: -30, bottom: 2 }

function renderIcon(size, detail = size <= 32 ? 'low' : 'high') {
  const b = ICON_BOUNDS
  const pad = size <= 32 ? 0 : size * 0.04
  const s = (size - pad * 2) / Math.max(b.right - b.left, b.bottom - b.top)
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  ctx.translate(size / 2 - ((b.left + b.right) / 2) * s, size / 2 - ((b.top + b.bottom) / 2) * s)
  drawTurtle(ctx, { scale: s, pose: 'icon', detail, shadow: false })
  return c.toDataURL('image/png')
}

window.MascotArt = Object.assign(window.MascotArt || {}, {
  turtle: { draw: drawTurtle, drawWaterBack, drawWaterFront, drawParticles, renderIcon },
})
})()
