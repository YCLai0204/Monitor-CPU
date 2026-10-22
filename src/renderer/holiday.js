'use strict'

/**
 * 台灣節日（彩蛋）：依農曆日期自動出現，所有吉祥物共用。
 *   'newyear'    春節（除夕～初五）：紅色小帽，點吉祥物會跳出紅包，黑熊的食物換成橘子
 *   'dragonboat' 端午（五月初三～初五）：紅色頭巾（像划龍舟的人），黑熊的食物換成粽子
 *   'midautumn'  中秋（八月十三～十五）：柚子皮帽，黑熊的食物換成月餅
 * 農曆用瀏覽器內建的 Intl 中國曆（en-u-ca-chinese）算，不用每年更新日期表；閏月不算節日。
 *
 * 帽子由各隻吉祥物的畫法在「頭」的座標系裡呼叫 drawHat，才會跟著頭一起動。
 * 包在 IIFE 裡的理由同 crab.js：幾支 <script> 共用全域範圍，避免同名變數衝突。
 */
;(function () {
const NAMES = { newyear: '新年快樂！', dragonboat: '端午節快樂！', midautumn: '中秋節快樂！' }

let lunarFmt = null

/** 農曆幾月幾日（閏月的 leap 是 true）；這台電腦的瀏覽器不支援中國曆就回傳 null。 */
function lunar(date) {
  try {
    if (!lunarFmt) lunarFmt = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric' })
    const parts = lunarFmt.formatToParts(date)
    const m = (parts.find((p) => p.type === 'month') || {}).value || ''
    const d = (parts.find((p) => p.type === 'day') || {}).value || ''
    const month = parseInt(m, 10)
    const day = parseInt(d, 10)
    if (!month || !day) return null
    return { month, day, leap: /bis/.test(m) }
  } catch (_) {
    return null
  }
}

/** 這一天是什麼節日（沒有的話是 null）。 */
function holidayOf(date = new Date()) {
  const l = lunar(date)
  if (!l || l.leap) return null
  if (l.month === 1 && l.day <= 5) return 'newyear'
  if (l.month === 5 && l.day >= 3 && l.day <= 5) return 'dragonboat'
  if (l.month === 8 && l.day >= 13 && l.day <= 15) return 'midautumn'
  // 除夕：明天就是正月初一（臘月有時候只有 29 天，所以不能只看 30 號）
  const next = lunar(new Date(date.getTime() + 24 * 3600 * 1000))
  if (next && !next.leap && next.month === 1 && next.day === 1) return 'newyear'
  return null
}

// ---------------------------------------------------------------- 帽子

/**
 * 在頭上戴節日的帽子。(x, y) 是帽子底部中心（頭頂），size 是帽子寬度，angle 是歪的角度。
 * 呼叫的地方要已經在頭的座標系裡（左右翻轉、轉頭都會跟著）。
 */
function drawHat(ctx, kind, x, y, size, angle = 0) {
  if (!kind) return
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.scale(size / 24, size / 24) // 以 24 寬為基準畫
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (kind === 'midautumn') drawPomelo(ctx)
  else if (kind === 'newyear') drawRedCap(ctx)
  else if (kind === 'dragonboat') drawHeadband(ctx)
  ctx.restore()
}

/** 柚子皮帽：剝下來的柚子皮倒扣在頭上，頂端一小截蒂頭和葉子。 */
function drawPomelo(ctx) {
  ctx.beginPath()
  ctx.moveTo(-12, 1)
  ctx.bezierCurveTo(-12, -11, -6, -15, 0, -15)
  ctx.bezierCurveTo(6, -15, 12, -11, 12, 1)
  // 柚子皮剝開的鋸齒邊
  for (let i = 0; i <= 6; i++) ctx.lineTo(12 - i * 4, i % 2 ? 3 : 0.5)
  ctx.closePath()
  const g = ctx.createLinearGradient(0, -15, 0, 2)
  g.addColorStop(0, '#d9e66a')
  g.addColorStop(1, '#a9bd3b')
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = '#6f7d1f'
  ctx.stroke()
  // 裡面白白的皮
  ctx.beginPath()
  ctx.moveTo(-10, 0.6)
  ctx.lineTo(10, 0.6)
  ctx.lineWidth = 1.4
  ctx.strokeStyle = '#f6f0d2'
  ctx.stroke()
  // 表皮上的小油點
  ctx.fillStyle = 'rgba(111, 125, 31, 0.5)'
  for (const [px, py] of [[-5, -9], [2, -11], [6, -6], [-7, -4], [0, -5]]) {
    ctx.beginPath()
    ctx.arc(px, py, 0.7, 0, Math.PI * 2)
    ctx.fill()
  }
  // 蒂頭和葉子
  ctx.beginPath()
  ctx.moveTo(0, -15)
  ctx.lineTo(0.5, -18)
  ctx.lineWidth = 1.6
  ctx.strokeStyle = '#6b4a2b'
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0.5, -17)
  ctx.quadraticCurveTo(5, -21, 8, -17)
  ctx.quadraticCurveTo(4, -15.5, 0.5, -17)
  ctx.fillStyle = '#4f8f2f'
  ctx.fill()
}

/** 新年的紅色小帽：金色帽緣、頂端一顆金色毛球。 */
function drawRedCap(ctx) {
  ctx.beginPath()
  ctx.moveTo(-11, 0)
  ctx.bezierCurveTo(-11, -12, -5, -16, 0, -16)
  ctx.bezierCurveTo(5, -16, 11, -12, 11, 0)
  ctx.closePath()
  const g = ctx.createLinearGradient(0, -16, 0, 0)
  g.addColorStop(0, '#ef4a43')
  g.addColorStop(1, '#c2181f')
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = '#7d0d12'
  ctx.stroke()
  // 金色帽緣
  ctx.beginPath()
  ctx.moveTo(-12.5, -1.5)
  ctx.quadraticCurveTo(0, -4.5, 12.5, -1.5)
  ctx.lineTo(12.5, 1.5)
  ctx.quadraticCurveTo(0, -1.5, -12.5, 1.5)
  ctx.closePath()
  ctx.fillStyle = '#f3c24a'
  ctx.fill()
  ctx.lineWidth = 0.8
  ctx.strokeStyle = '#a7791b'
  ctx.stroke()
  // 金色毛球
  ctx.beginPath()
  ctx.arc(0, -16.5, 3, 0, Math.PI * 2)
  ctx.fillStyle = '#f7cf5c'
  ctx.fill()
  ctx.stroke()
}

/** 端午的紅色頭巾：綁在頭上的一條布，後面打結、兩條布尾飄出來。 */
function drawHeadband(ctx) {
  ctx.beginPath()
  ctx.moveTo(-12, -1)
  ctx.quadraticCurveTo(0, -5, 12, -1)
  ctx.lineTo(12, 3)
  ctx.quadraticCurveTo(0, -1, -12, 3)
  ctx.closePath()
  ctx.fillStyle = '#d8262c'
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = '#7d0d12'
  ctx.stroke()
  // 結和兩條布尾（往後飄，面向右邊時在左邊）
  ctx.beginPath()
  ctx.arc(-12, 1, 2.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  for (const [dy, len] of [[-1, 9], [2.5, 7]]) {
    ctx.beginPath()
    ctx.moveTo(-13, 1)
    ctx.quadraticCurveTo(-13 - len * 0.5, 1 + dy - 2, -13 - len, 1 + dy * 1.6)
    ctx.lineWidth = 2.6
    ctx.strokeStyle = '#d8262c'
    ctx.stroke()
  }
}

// ---------------------------------------------------------------- 節日食物

/** 節日的點心（黑熊的食物換成這個）：原點是底部中心，大小跟青剛櫟果實差不多。 */
function drawTreat(ctx, kind, x = 0, y = 0) {
  ctx.save()
  ctx.translate(x, y)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (kind === 'midautumn') {
    // 月餅：金黃色的圓餅，邊緣一圈花紋、中間蓋印
    ctx.beginPath()
    ctx.ellipse(0, -5.5, 8, 5.5, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#c98a3f'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = '#7e4f1c'
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(0, -6.5, 6.5, 3.8, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#e0a95c'
    ctx.fill()
    ctx.lineWidth = 0.7
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(0, -6.5, 3, 1.8, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (kind === 'dragonboat') {
    // 粽子：竹葉包的三角錐，綁一圈繩子
    ctx.beginPath()
    ctx.moveTo(-8, 0)
    ctx.lineTo(8, 0)
    ctx.lineTo(1, -13)
    ctx.closePath()
    ctx.fillStyle = '#6e9b3a'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = '#3f6a1f'
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-1, -12)
    ctx.lineTo(-5, -1)
    ctx.lineWidth = 0.7
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-5.5, -4.5)
    ctx.lineTo(6, -4.5)
    ctx.lineWidth = 1.4
    ctx.strokeStyle = '#d9c49a'
    ctx.stroke()
  } else if (kind === 'newyear') {
    // 橘子（大吉大利）：圓圓的橘色，上面一片葉子
    ctx.beginPath()
    ctx.arc(0, -6.5, 6.5, 0, Math.PI * 2)
    ctx.fillStyle = '#f39a2a'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = '#a95b0e'
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(-2, -9, 1.6, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(0, -13)
    ctx.quadraticCurveTo(4, -17, 7, -13.5)
    ctx.quadraticCurveTo(3.5, -12, 0, -13)
    ctx.fillStyle = '#4f8f2f'
    ctx.fill()
  }
  ctx.restore()
}

// ---------------------------------------------------------------- 紅包

/** 一個紅包（原點在中間）：紅色信封、金色的「福」字框。 */
function drawEnvelope(ctx, scale = 1, angle = 0) {
  ctx.save()
  ctx.scale(scale, scale)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.rect(-6, -8, 12, 16)
  ctx.fillStyle = '#d8262c'
  ctx.fill()
  ctx.lineWidth = 0.9
  ctx.strokeStyle = '#7d0d12'
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-6, -8)
  ctx.lineTo(0, -3)
  ctx.lineTo(6, -8)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 2, 3, 0, Math.PI * 2)
  ctx.fillStyle = '#f3c24a'
  ctx.fill()
  ctx.restore()
}

window.HolidayArt = { holidayOf, greeting: (kind) => NAMES[kind] || '', drawHat, drawTreat, drawEnvelope }
})()
