'use strict'

/**
 * 台灣黑熊（Q 版、兩腳站立）：黑色的身體、胸前米白色的 V 字、咖啡色口鼻、圓耳朵。
 * 跟螃蟹一樣是用 Canvas 即時畫出來的，沒有圖檔。
 *
 * 座標原點放在黑熊的「腳底中心」，往上是負的。
 * 平常正面看著前面；look（-1 左 … 0 正面 … 1 右）不是 0 時臉轉向那一邊，app.js 只在走路時給。
 * 動作用的是螃蟹那一套爬行方式（app.js 的 'crawl'），這支只依 pose 畫出姿勢：
 *   'walk'     走路：兩腳交替、手臂前後擺
 *   'climb'    貼在牆上或視窗側邊：身體直立，雙手雙腳伸到 wall（1 右、-1 左）那一側扒著牆，輪流往上爬
 *   'ceiling'  倒掛：雙手舉高抓著
 *   'fall'     在空中：手腳張開亂揮
 *   'held'     被抓著：手舉高、腳亂踢
 *   'sit'      坐在視窗頂端（像坐在樹上的熊窩）：腳往前伸，看得到腳底的肉墊
 *   'eat'      坐著雙手抱著青剛櫟果實啃（holding = 'salmon' 時抱的是抓到的鮭魚，彩蛋）
 *   'run'      負載高時四腳著地衝刺：側面、頭朝 dir 那一邊，跑步時身體上下起伏、後面揚起塵土
 *   'icon'     圖示用的站姿
 *
 * drawFood 畫的是偷偷放在視窗頂端的食物：青剛櫟的果實，秋冬時台灣黑熊會爬到樹上吃。
 *
 * 包在 IIFE 裡的理由同 crab.js：幾支 <script> 共用全域範圍，避免同名變數衝突。
 */
;(function () {
const C = {
  fur: '#1d1d22',
  furHi: '#3a3a44',
  outline: '#0b0b0e',
  crest: '#f2e7c9',       // 胸前的 V 字
  muzzle: '#c8a079',
  muzzleDark: '#9b7552',
  nose: '#141416',
  earIn: '#4a3c3a',
  pad: '#5a4a48',
  eyeWhite: '#fbfbfd',
  eye: '#141416',
  blush: 'rgba(255, 120, 140, 0.75)',
}

function drawBear(ctx, opts) {
  const {
    scale = 1,
    phase = 0,
    speed = 0,
    dir = 1,
    look = 0,
    lookY = 0,       // -1 往上看 … 1 往下看（爬牆時往爬的方向看）
    wall = 0,
    pose = 'walk',
    heat = 0,
    blink = 0,
    detail = 'high',
    shadow = true,
    time = 0,
    holding = null,  // 'eat' 時手上拿的東西：null 是青剛櫟果實，'salmon' 是抓到的鮭魚（彩蛋）
    hat = null,      // 節日的帽子（holiday.js）
    holiday = null,  // 節日（holiday.js）：吃的東西換成那個節日的點心
  } = opts

  const low = detail === 'low'
  const icon = pose === 'icon'
  // 腳步幅度跟著速度平滑變大變小：停下來時慢慢收回，不會一下子跳回站姿。
  // 身體和手走路時都不動，只有腳在走、臉轉向前進方向。
  const stride = pose === 'walk' ? Math.min(1, speed / 45) : 0

  ctx.save()
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (shadow && (pose === 'walk' || pose === 'sit' || pose === 'eat' || icon)) {
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(0, 1, 22, 3.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  if (pose === 'run') {
    drawRun(ctx, { dir, phase, speed, heat, blink, low, time, hat })
    ctx.restore()
    return
  }

  if (pose === 'climb' && wall) {
    // 扒著牆：身體側向牆、微微靠過去，四肢都伸到牆上；頭最後畫，手臂才不會擋到臉
    ctx.save()
    ctx.translate(0, -31)
    ctx.rotate(wall * 0.1)
    ctx.translate(0, 31)
    drawBody(ctx, low, wall * 0.7)
    drawClimbLimbs(ctx, wall, phase, low)
    drawHead(ctx, { blink, heat, low, pose, look, lookY, hat })
    ctx.restore()
    if (heat > 0.35 && !low) drawSweat(ctx, heat, time)
    ctx.restore()
    return
  }

  const seated = pose === 'sit' || pose === 'eat'
  if (seated) {
    // 坐下來：上半身往下沉，腳往前伸
    drawSeatedFeet(ctx, low)
    ctx.translate(0, SIT_DROP)
  } else {
    drawLegs(ctx, pose, phase, stride, low, look)
  }
  // 兩隻手都畫在身體前面（轉頭時換前後層會一閃一閃的，看起來不自然）
  drawBody(ctx, low)
  const chew = pose === 'eat' ? Math.max(0, Math.sin(time * 0.018)) * 1.5 : 0
  drawHead(ctx, { blink, heat, low, pose, look, chew, hat })
  for (const side of [-1, 1]) drawArm(ctx, side, armAngle(pose, side, phase, time), low)
  if (pose === 'eat' && holding === 'salmon' && window.MascotArt && window.MascotArt.salmon) {
    // 彩蛋：抓到的鮭魚，在手上扭來扭去
    ctx.save()
    ctx.translate(0.5, -39 + chew)
    window.MascotArt.salmon.draw(ctx, { scale: 0.45, pose: 'held', time })
    ctx.restore()
  } else if (pose === 'eat' && holiday && window.HolidayArt) {
    // 節日：捧著那個節日的點心（月餅、粽子、橘子）
    ctx.save()
    ctx.translate(0.5, -40 + chew)
    window.HolidayArt.drawTreat(ctx, holiday)
    ctx.restore()
  } else if (pose === 'eat') {
    // 雙手捧在嘴巴正前方的果實，跟著咀嚼一起動
    ctx.save()
    ctx.translate(0.5, -47 + chew)
    ctx.scale(0.75, 0.75)
    drawAcorn(ctx, 0, 0, -0.15)
    ctx.restore()
  }
  if (heat > 0.35 && !low && !icon) drawSweat(ctx, heat, time)

  ctx.restore()
}

/**
 * 手臂的角度（0 = 直直垂下，負的往外張開）。畫的時候會乘上 side，所以同一個值左右手是對稱的。
 * 站著時兩手垂在身體兩旁、稍微往外，才不會擋在肚子前面。
 */
const ARM_REST = -0.32
const ARM_EAT = 2.2        // 雙手往內抱到嘴巴前面（再高會擋到眼睛）
const SIT_DROP = 10        // 坐下時上半身往下沉多少

function armAngle(pose, side, phase, time) {
  switch (pose) {
    case 'eat':
      return ARM_EAT
    case 'climb':
    case 'ceiling':
      // 雙手舉高往外開（太直會被頭擋住），輪流往上抓
      return -2.25 + Math.sin(phase + (side < 0 ? 0 : Math.PI)) * 0.3
    case 'held':
      return -2.4 + Math.sin(time * 0.02 + side) * 0.3
    case 'fall':
      return side * 1.4 - 0.6 + Math.sin(time * 0.03 + side * 2) * 0.5
    default:
      // 站著和走路都垂在身體前方兩側，不擺動
      return ARM_REST
  }
}

function drawLegs(ctx, pose, phase, stride, low, look) {
  // 腳掌朝向跟臉一樣：往哪邊走就朝哪邊，正面時朝前（置中）
  const toe = look * 2.5
  for (const side of [-1, 1]) {
    let fx = side * 8
    let fy = 0
    if (pose === 'walk') {
      const s = Math.sin(phase + (side < 0 ? 0 : Math.PI)) * stride
      fx += s * 5
      fy = -Math.max(0, s) * 3.5
    } else if (pose === 'climb' || pose === 'ceiling') {
      // 腳蹬著牆：一前一後
      fy = -Math.max(0, Math.sin(phase + (side < 0 ? Math.PI : 0))) * 5
    } else if (pose === 'held' || pose === 'fall') {
      fy = 4 + Math.sin(phase + (side < 0 ? 0 : Math.PI)) * 3
      fx += side * 2
    }
    ctx.beginPath()
    ctx.moveTo(side * 9, -20)
    ctx.lineTo(fx, fy - 4)
    ctx.lineWidth = low ? 12 : 10
    ctx.strokeStyle = C.fur
    ctx.stroke()
    // 腳掌
    ctx.beginPath()
    ctx.ellipse(fx + toe, fy - 2.5, 6.5, 3.6, 0, 0, Math.PI * 2)
    ctx.fillStyle = C.fur
    ctx.fill()
    if (!low) {
      ctx.beginPath()
      ctx.ellipse(fx + toe * 1.3, fy - 2, 3.6, 1.8, 0, 0, Math.PI * 2)
      ctx.fillStyle = C.pad
      ctx.fill()
    }
  }
}

/**
 * 四腳衝刺（側面，預設頭朝右，dir = -1 時左右翻過來）。
 * 跑步的節奏：前腳一對、後腳一對輪流蹬地，身體跟著起伏、微微前後傾。
 */
function drawRun(ctx, { dir, phase, speed, heat, blink, low, time, hat }) {
  const p = phase
  const lift = Math.max(0, Math.sin(p * 2)) * 4 // 一步跳起來一下
  const tilt = Math.sin(p) * 0.07

  // 影子比站著寬
  ctx.save()
  ctx.globalAlpha = 0.22
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.ellipse(0, 1, 30, 3.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.scale(dir < 0 ? -1 : 1, 1)

  // 後面揚起的塵土
  if (!low) {
    for (let i = 0; i < 3; i++) {
      const t = (time * 0.003 + i / 3) % 1
      ctx.globalAlpha = (1 - t) * 0.45 * Math.min(1, speed / 120)
      ctx.fillStyle = '#d9cdb8'
      ctx.beginPath()
      ctx.arc(-30 - t * 22, -3 - t * 7, 2.5 + t * 4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  ctx.translate(0, -lift)
  ctx.save()
  ctx.translate(0, -24)
  ctx.rotate(tilt)
  ctx.translate(0, 24)

  // 腳：遠的那一側（較暗）先畫在身體後面，近的那一側畫在前面
  const leg = (x, o, near) => {
    const s = Math.sin(p + o)
    const fx = x + s * 9
    const fy = -Math.max(0, -Math.cos(p + o)) * 6
    ctx.beginPath()
    ctx.moveTo(x, -20)
    ctx.lineTo(fx, fy - 3)
    ctx.lineWidth = low ? 11 : 9
    ctx.strokeStyle = near ? C.fur : '#121216'
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(fx + 2, fy - 2.5, 5.5, 3.2, 0, 0, Math.PI * 2)
    ctx.fillStyle = near ? C.fur : '#121216'
    ctx.fill()
  }
  leg(14, 0.6, false)
  leg(-15, Math.PI + 0.6, false)

  // 身體：橫躺的橢圓
  const g = ctx.createRadialGradient(-4, -32, 2, 0, -26, 30)
  g.addColorStop(0, C.furHi)
  g.addColorStop(1, C.fur)
  ctx.beginPath()
  ctx.ellipse(0, -26, 27, 15, 0, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = low ? 2.4 : 1.4
  ctx.strokeStyle = C.outline
  ctx.stroke()
  // 小尾巴
  ctx.beginPath()
  ctx.arc(-26, -31, 3.2, 0, Math.PI * 2)
  ctx.fillStyle = C.fur
  ctx.fill()

  // 胸前 V 字的一半（側面只看得到前面那段）
  ctx.beginPath()
  ctx.moveTo(14, -36)
  ctx.quadraticCurveTo(19, -28, 24, -24)
  ctx.lineWidth = low ? 5 : 4
  ctx.strokeStyle = C.crest
  ctx.stroke()

  leg(-12, Math.PI, true)
  leg(17, 0, true)

  // 頭：往前伸，耳朵往後
  const hx = 26
  const hy = -36
  ctx.beginPath()
  ctx.arc(hx - 6, hy - 11, 5.5, 0, Math.PI * 2)
  ctx.fillStyle = C.fur
  ctx.fill()
  ctx.lineWidth = low ? 2.2 : 1.2
  ctx.strokeStyle = C.outline
  ctx.stroke()
  if (!low) {
    ctx.beginPath()
    ctx.arc(hx - 6, hy - 11, 2.6, 0, Math.PI * 2)
    ctx.fillStyle = C.earIn
    ctx.fill()
  }
  const hg = ctx.createRadialGradient(hx - 4, hy - 4, 2, hx, hy, 17)
  hg.addColorStop(0, C.furHi)
  hg.addColorStop(1, C.fur)
  ctx.beginPath()
  ctx.ellipse(hx, hy, 14, 13, 0, 0, Math.PI * 2)
  ctx.fillStyle = hg
  ctx.fill()
  ctx.lineWidth = low ? 2.4 : 1.4
  ctx.strokeStyle = C.outline
  ctx.stroke()
  // 節日的帽子：衝刺時頭往前伸，帽子跟著往前歪一點
  if (hat && window.HolidayArt) window.HolidayArt.drawHat(ctx, hat, hx + 1, hy - 10, 21, 0.2)
  // 口鼻往前凸
  ctx.beginPath()
  ctx.ellipse(hx + 12, hy + 4, 7.5, 5.5, 0.1, 0, Math.PI * 2)
  ctx.fillStyle = C.muzzle
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(hx + 17.5, hy + 1.5, 2.8, 2.2, 0, 0, Math.PI * 2)
  ctx.fillStyle = C.nose
  ctx.fill()
  if (!low) {
    // 衝刺時嘴巴張開喘氣
    ctx.beginPath()
    ctx.ellipse(hx + 13, hy + 7.5, 2.6, 1.8, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#6b2b2b'
    ctx.fill()
  }
  // 眼睛
  const er = low ? 3.4 : 3
  ctx.beginPath()
  ctx.ellipse(hx + 4, hy - 3, er, er * (1 - blink * 0.9), 0, 0, Math.PI * 2)
  ctx.fillStyle = C.eyeWhite
  ctx.fill()
  if (blink < 0.6) {
    ctx.beginPath()
    ctx.ellipse(hx + 5, hy - 3, er * 0.6, er * 0.65 * (1 - blink), 0, 0, Math.PI * 2)
    ctx.fillStyle = C.eye
    ctx.fill()
  }
  if (heat > 0 && !low) {
    ctx.beginPath()
    ctx.ellipse(hx + 3, hy + 5, 3.6, 2.3, 0, 0, Math.PI * 2)
    ctx.globalAlpha = heat
    ctx.fillStyle = C.blush
    ctx.fill()
    ctx.globalAlpha = 1
  }
  ctx.restore()

  if (heat > 0.35 && !low) {
    // 汗滴往後飛
    ctx.save()
    const t = (time * 0.002) % 1
    ctx.globalAlpha = (1 - t) * Math.min(1, (heat - 0.35) * 3)
    ctx.fillStyle = '#8fd3ff'
    ctx.beginPath()
    ctx.ellipse(12 - t * 18, -58 + t * 6, 2.2, 3.2, -0.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

/** 牆的位置（離腳底中心的水平距離），要跟 app.js 的 CLIMB_GAP 一致：手腳伸到這裡剛好碰到牆。 */
const WALL_X = 25

/**
 * 扒著牆的四肢：w 是牆在哪一邊。兩手一高一低、兩腳一高一低，跟著 phase 輪流往上抓，
 * 掌心的肉墊壓在牆面上。
 */
function drawClimbLimbs(ctx, w, phase, low) {
  const a = Math.sin(phase) * 5
  const limbs = [
    // [起點 x, 起點 y, 手腳碰牆的 y, 線寬]
    [14, -44, -58 + a, low ? 11 : 9], // 上面那隻手
    [15, -37, -44 - a, low ? 11 : 9], // 下面那隻手
    [7, -22, -20 - a, low ? 12 : 10], // 上面那隻腳
    [6, -16, -6 + a, low ? 12 : 10],  // 下面那隻腳
  ]
  for (const [sx, sy, ty, width] of limbs) {
    const tx = w * (WALL_X - 4)
    ctx.beginPath()
    ctx.moveTo(w * sx, sy)
    ctx.quadraticCurveTo(w * (sx + 8), (sy + ty) / 2 - 3, tx, ty)
    ctx.lineWidth = width
    ctx.strokeStyle = C.fur
    ctx.stroke()
    // 壓在牆上的掌心
    ctx.beginPath()
    ctx.ellipse(tx + w * 1.5, ty, 3.6, 5.6, 0, 0, Math.PI * 2)
    ctx.fillStyle = C.fur
    ctx.fill()
    if (!low) {
      ctx.beginPath()
      ctx.ellipse(tx + w * 2.2, ty, 1.8, 3.4, 0, 0, Math.PI * 2)
      ctx.fillStyle = C.pad
      ctx.fill()
    }
  }
}

/** 坐著時往前伸的兩隻腳，正面看得到腳底的肉墊。 */
function drawSeatedFeet(ctx, low) {
  for (const side of [-1, 1]) {
    const x = side * 11
    ctx.beginPath()
    ctx.ellipse(x, -6, 8, 7, 0, 0, Math.PI * 2)
    ctx.fillStyle = C.fur
    ctx.fill()
    ctx.lineWidth = low ? 2.2 : 1.2
    ctx.strokeStyle = C.outline
    ctx.stroke()
    if (!low) {
      ctx.beginPath()
      ctx.ellipse(x, -4.5, 4, 3.4, 0, 0, Math.PI * 2)
      ctx.fillStyle = C.pad
      ctx.fill()
      for (const t of [-1, 0, 1]) {
        ctx.beginPath()
        ctx.arc(x + t * 3, -9.5 + Math.abs(t) * 0.8, 1.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}

function drawArm(ctx, side, angle, low) {
  ctx.save()
  ctx.translate(side * 14, -42)
  ctx.rotate(angle * side)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, 16)
  ctx.lineWidth = low ? 11 : 9
  ctx.strokeStyle = C.fur
  ctx.stroke()
  if (!low) {
    ctx.beginPath()
    ctx.arc(0, 17, 3, 0, Math.PI * 2)
    ctx.fillStyle = C.pad
    ctx.fill()
  }
  ctx.restore()
}

/** 身體；turn（-1..1）不是 0 時側向那一邊：身體變窄、胸前的 V 字跟著偏過去。 */
function drawBody(ctx, low, turn = 0) {
  const narrow = 1 - Math.abs(turn) * 0.18
  const g = ctx.createRadialGradient(-6, -38, 2, 0, -32, 24)
  g.addColorStop(0, C.furHi)
  g.addColorStop(1, C.fur)
  ctx.beginPath()
  ctx.ellipse(0, -31, 19 * narrow, 19, 0, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = low ? 2.4 : 1.4
  ctx.strokeStyle = C.outline
  ctx.stroke()

  // 胸前的 V 字：台灣黑熊最好認的地方
  ctx.save()
  ctx.translate(turn * 5, 0)
  ctx.scale(1 - Math.abs(turn) * 0.3, 1)
  ctx.beginPath()
  ctx.moveTo(-13, -42)
  ctx.quadraticCurveTo(-5, -36, 0, -29)
  ctx.quadraticCurveTo(5, -36, 13, -42)
  ctx.restore()
  ctx.lineWidth = low ? 6 : 5
  ctx.strokeStyle = C.crest
  ctx.stroke()
}

function drawHead(ctx, { blink, heat, low, pose, look, lookY = 0, chew = 0, hat = null }) {
  const cx = look * 1.5
  const cy = -60 + chew
  const fy = lookY * 3.5 // 五官往上或往下移，看起來像抬頭、低頭
  const r = 17

  // 耳朵
  for (const ex of [-12 + look, 12 + look]) {
    ctx.beginPath()
    ctx.arc(cx + ex, cy - 12, 6.5, 0, Math.PI * 2)
    ctx.fillStyle = C.fur
    ctx.fill()
    ctx.lineWidth = low ? 2.2 : 1.2
    ctx.strokeStyle = C.outline
    ctx.stroke()
    if (!low) {
      ctx.beginPath()
      ctx.arc(cx + ex, cy - 12, 3.2, 0, Math.PI * 2)
      ctx.fillStyle = C.earIn
      ctx.fill()
    }
  }

  // 頭
  const g = ctx.createRadialGradient(cx - 5, cy - 6, 2, cx, cy, r + 4)
  g.addColorStop(0, C.furHi)
  g.addColorStop(1, C.fur)
  ctx.beginPath()
  ctx.ellipse(cx, cy, r, r * 0.94, 0, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = low ? 2.4 : 1.4
  ctx.strokeStyle = C.outline
  ctx.stroke()

  // 口鼻：正面時在正中間，轉頭時往那一邊偏
  const mx = cx + look * 6
  const my = cy + 5 + fy
  ctx.beginPath()
  ctx.ellipse(mx, my, low ? 9 : 8.5, low ? 7 : 6.2, 0, 0, Math.PI * 2)
  ctx.fillStyle = C.muzzle
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(mx + look * 2, my - 3, low ? 4 : 3.4, low ? 3 : 2.4, 0, 0, Math.PI * 2)
  ctx.fillStyle = C.nose
  ctx.fill()
  if (!low) {
    // 嘴巴；被抓或掉下來時張開
    ctx.beginPath()
    if (pose === 'held' || pose === 'fall') {
      ctx.ellipse(mx + look * 1.5, my + 3, 2.4, 2, 0, 0, Math.PI * 2)
      ctx.fillStyle = '#6b2b2b'
      ctx.fill()
    } else {
      ctx.moveTo(mx - 3 + look * 1.5, my + 2.5)
      ctx.quadraticCurveTo(mx + look * 1.5, my + 5, mx + 3 + look * 1.5, my + 2.5)
      ctx.lineWidth = 1.2
      ctx.strokeStyle = C.muzzleDark
      ctx.stroke()
    }
  }

  // 眼睛：黑毛上看不到黑眼珠，所以畫白色眼白；兩隻保持一樣大，遠的那隻縮小會變成大小眼
  for (const side of [-1, 1]) {
    const k = 1
    const ex = cx + side * 6 + look * 3
    const ey = cy - 4 + fy * 0.8
    const er = (low ? 3.6 : 3.2) * k
    ctx.beginPath()
    ctx.ellipse(ex, ey, er, er * (1 - blink * 0.9), 0, 0, Math.PI * 2)
    ctx.fillStyle = C.eyeWhite
    ctx.fill()
    if (blink < 0.6) {
      ctx.beginPath()
      ctx.ellipse(ex + look * 0.9, ey, er * 0.6, er * 0.65 * (1 - blink), 0, 0, Math.PI * 2)
      ctx.fillStyle = C.eye
      ctx.fill()
      if (!low) {
        ctx.beginPath()
        ctx.arc(ex + look * 0.9 + 0.8, ey - 1, 0.7, 0, Math.PI * 2)
        ctx.fillStyle = '#fff'
        ctx.fill()
      }
    }
  }

  // 負載高時臉紅
  if (heat > 0 && !low) {
    ctx.beginPath()
    ctx.ellipse(cx - 10 + look * 3, cy + 4 + fy, 3.6 - Math.max(0, look) * 1, 2.4, 0, 0, Math.PI * 2)
    ctx.ellipse(cx + 10 + look * 3, cy + 4 + fy, 3.6 - Math.max(0, -look) * 1, 2.4, 0, 0, Math.PI * 2)
    ctx.globalAlpha = heat
    ctx.fillStyle = C.blush
    ctx.fill()
    ctx.globalAlpha = 1
  }
  // 節日的帽子：戴在兩隻耳朵中間
  if (hat && window.HolidayArt) window.HolidayArt.drawHat(ctx, hat, cx, cy - 13, 24)
}

function drawSweat(ctx, heat, time) {
  ctx.save()
  const n = heat > 0.7 ? 2 : 1
  for (let i = 0; i < n; i++) {
    const t = (time * 0.0012 + i * 0.5) % 1
    const x = i === 0 ? 22 + t * 3 : -18 - t * 3
    const y = -70 + t * 16
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

// ---------------------------------------------------------------- 食物

const FOOD = {
  nut: '#a8652c',
  nutHi: '#d08d4a',
  cap: '#6b4a2b',
  capLine: '#4a321c',
  leaf: '#5f8f3a',
  leafVein: '#3f6a24',
}

/** 一顆青剛櫟果實：(x, y) 是果實底部，往上長；tilt 是傾斜角度。 */
function drawAcorn(ctx, x, y, tilt) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(tilt)
  // 果實
  const g = ctx.createLinearGradient(-5, -12, 5, 0)
  g.addColorStop(0, FOOD.nutHi)
  g.addColorStop(1, FOOD.nut)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(-6.5, -2, -6, -9)
  ctx.lineTo(6, -9)
  ctx.quadraticCurveTo(6.5, -2, 0, 0)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = FOOD.capLine
  ctx.stroke()
  // 殼斗（帽子），青剛櫟是一圈一圈的橫紋
  ctx.beginPath()
  ctx.ellipse(0, -10, 7.2, 3.6, 0, 0, Math.PI * 2)
  ctx.fillStyle = FOOD.cap
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = FOOD.capLine
  ctx.lineWidth = 0.8
  for (const dy of [-1.2, 0.8]) {
    ctx.beginPath()
    ctx.ellipse(0, -10 + dy, 6, 1.8, 0, 0.1 * Math.PI, 0.9 * Math.PI)
    ctx.stroke()
  }
  // 蒂頭
  ctx.beginPath()
  ctx.moveTo(0, -13.5)
  ctx.lineTo(0.8, -16)
  ctx.lineWidth = 1.4
  ctx.stroke()
  ctx.restore()
}

/** 偷偷放在視窗頂端的食物：兩顆青剛櫟果實和一片葉子，原點是放在視窗頂端的位置，偶爾閃一下。 */
function drawFood(ctx, { scale = 1, time = 0, holiday = null } = {}) {
  ctx.save()
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (holiday && window.HolidayArt) {
    // 節日：換成那個節日的點心，兩個並排
    window.HolidayArt.drawTreat(ctx, holiday, -5, 0)
    window.HolidayArt.drawTreat(ctx, holiday, 6, 0)
    ctx.restore()
    return
  }
  // 葉子
  ctx.beginPath()
  ctx.moveTo(-14, -1)
  ctx.quadraticCurveTo(-11, -10, -2, -8)
  ctx.quadraticCurveTo(-6, -1, -14, -1)
  ctx.fillStyle = FOOD.leaf
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-13, -1.5)
  ctx.lineTo(-4, -7.5)
  ctx.lineWidth = 0.8
  ctx.strokeStyle = FOOD.leafVein
  ctx.stroke()
  drawAcorn(ctx, -3, 0, -0.25)
  drawAcorn(ctx, 6, 0, 0.3)
  // 閃一下，讓人注意到「好像多了什麼」
  const t = (time * 0.0006) % 1
  if (t < 0.25) {
    const a = Math.sin((t / 0.25) * Math.PI)
    ctx.globalAlpha = a
    ctx.fillStyle = '#fff6c8'
    ctx.beginPath()
    const sx = 11
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

/** 圖示用的外框（腳底為原點），站姿固定，直接寫死就好。小圖示只取頭和胸前的 V 字，整隻縮下去會看不清楚。 */
const ICON_BOUNDS = { left: -23, right: 26, top: -79, bottom: 2 }
const ICON_BUST = { left: -23, right: 26, top: -79, bottom: -30 }

/** 把站著的黑熊畫成 size×size 的 PNG data URL；32px 以下用粗線條、省略細節、只畫半身。 */
function renderIcon(size, detail = size <= 32 ? 'low' : 'high') {
  const b = size <= 32 ? ICON_BUST : ICON_BOUNDS
  const pad = size <= 32 ? 0 : size * 0.04
  const s = (size - pad * 2) / Math.max(b.right - b.left, b.bottom - b.top)
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  ctx.translate(size / 2 - ((b.left + b.right) / 2) * s, size / 2 - ((b.top + b.bottom) / 2) * s)
  drawBear(ctx, { scale: s, pose: 'icon', detail, shadow: false })
  return c.toDataURL('image/png')
}

window.MascotArt = Object.assign(window.MascotArt || {}, { bear: { draw: drawBear, drawFood, renderIcon } })
})()
