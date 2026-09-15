'use strict'

const { nativeImage } = require('electron')

const SIZE = 32
const SS = 3 // 超取樣倍率，邊緣才不會鋸齒

/**
 * 直接用程式畫出系統匣的螃蟹圖示，顏色跟著負載走。
 * 這樣就不需要附帶任何圖檔，打包後也不會有找不到資源的問題。
 */
function createCrabIcon(load) {
  const { r, g, b } = loadToRgb(load)
  const shade = { r: Math.round(r * 0.62), g: Math.round(g * 0.62), b: Math.round(b * 0.62) }
  const buf = Buffer.alloc(SIZE * SIZE * 4) // BGRA

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let hits = 0
      let eyeHits = 0
      let samples = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          samples++
          if (isEye(px, py)) eyeHits++
          else if (isCrab(px, py)) hits++
        }
      }
      const i = (y * SIZE + x) * 4
      const bodyA = hits / samples
      const eyeA = eyeHits / samples
      const alpha = bodyA + eyeA
      if (alpha <= 0) continue

      const col = eyeA > bodyA ? { r: 20, g: 20, b: 26 } : (py2IsLower(y) ? shade : { r, g, b })
      // Windows 的點陣圖要的是預乘 alpha，否則邊緣會出現白邊
      const a = Math.min(1, alpha)
      buf[i] = Math.round(col.b * a)
      buf[i + 1] = Math.round(col.g * a)
      buf[i + 2] = Math.round(col.r * a)
      buf[i + 3] = Math.round(a * 255)
    }
  }

  return nativeImage.createFromBitmap(buf, { width: SIZE, height: SIZE })
}

function py2IsLower(y) {
  return y > 19
}

function isCrab(x, y) {
  // 身體
  if (ellipse(x, y, 16, 18, 10, 7)) return true
  // 兩隻大螯
  if (circle(x, y, 5.5, 11.5, 4.2) && !circle(x, y, 4.0, 10.0, 2.0)) return true
  if (circle(x, y, 26.5, 11.5, 4.2) && !circle(x, y, 28.0, 10.0, 2.0)) return true
  // 腳
  for (const [ox, oy] of [[-11, 1], [-10.5, 4], [-9, 6.5]]) {
    if (segment(x, y, 16 + ox * 0.55, 18 + oy * 0.6, 16 + ox, 18 + oy, 1.5)) return true
    if (segment(x, y, 16 - ox * 0.55, 18 + oy * 0.6, 16 - ox, 18 + oy, 1.5)) return true
  }
  // 眼柄
  if (segment(x, y, 12.5, 13.5, 12.5, 9.5, 1.2)) return true
  if (segment(x, y, 19.5, 13.5, 19.5, 9.5, 1.2)) return true
  return false
}

function isEye(x, y) {
  return circle(x, y, 12.5, 8.6, 1.9) || circle(x, y, 19.5, 8.6, 1.9)
}

function ellipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx
  const dy = (y - cy) / ry
  return dx * dx + dy * dy <= 1
}

function circle(x, y, cx, cy, r) {
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function segment(px, py, x1, y1, x2, y2, w) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return (px - cx) ** 2 + (py - cy) ** 2 <= w * w
}

/** 0% 是青色、100% 是紅色，中間走 HSL 色相。 */
function loadToRgb(load) {
  const t = Math.max(0, Math.min(1, (load || 0) / 100))
  const hue = 186 - 186 * t
  return hslToRgb(hue, 0.72, 0.5)
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

module.exports = { createCrabIcon, loadToRgb }
