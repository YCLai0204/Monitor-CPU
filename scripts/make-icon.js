'use strict'

/**
 * 產生 exe 圖示：build/icon.ico（多尺寸）與 build/icon.png（256px）。
 *
 * 直接拿 src/renderer/crab.js 的 renderIcon 在隱藏視窗裡畫，所以圖示跟工具列上
 * 跑的那隻螃蟹是同一份畫法，改了螃蟹長相後重跑這支就會同步。
 *
 *   npm run icon
 *   npm run icon -- --preview=某個資料夾   ← 另外把每個尺寸存成 PNG，方便檢查
 *
 * .ico 是用 PNG 內嵌格式（Vista 以後都支援）自己組的，不需要任何額外套件。
 */

const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'build')
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const ICON_HUE = 186 // 閒置時的青色，也就是大家平常看到的那隻

const previewArg = process.argv.find((a) => a.startsWith('--preview='))
const previewDir = previewArg ? path.resolve(previewArg.slice('--preview='.length)) : null

function buildIco(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const entries = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  pngs.forEach(({ size, data }, i) => {
    const e = 16 * i
    entries.writeUInt8(size >= 256 ? 0 : size, e) // 0 代表 256
    entries.writeUInt8(size >= 256 ? 0 : size, e + 1)
    entries.writeUInt8(0, e + 2) // palette
    entries.writeUInt8(0, e + 3) // reserved
    entries.writeUInt16LE(1, e + 4) // planes
    entries.writeUInt16LE(32, e + 6) // bpp
    entries.writeUInt32LE(data.length, e + 8)
    entries.writeUInt32LE(offset, e + 12)
    offset += data.length
  })

  return Buffer.concat([header, entries, ...pngs.map((p) => p.data)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  try {
    await win.loadURL('about:blank')
    const crabSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'crab.js'), 'utf8')
    const render = `(() => {
      const out = {}
      for (const size of ${JSON.stringify(SIZES)}) out[size] = window.CrabArt.renderIcon(size, ${ICON_HUE})
      return out
    })()`
    const urls = await win.webContents.executeJavaScript(`${crabSrc}\n;${render}`)

    const pngs = SIZES.map((size) => ({
      size,
      data: Buffer.from(urls[size].replace(/^data:image\/png;base64,/, ''), 'base64'),
    }))

    fs.mkdirSync(OUT_DIR, { recursive: true })
    fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildIco(pngs))
    fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), pngs.find((p) => p.size === 256).data)
    console.log(`已產生 build/icon.ico（${SIZES.join('、')} px）`)

    if (previewDir) {
      fs.mkdirSync(previewDir, { recursive: true })
      for (const p of pngs) fs.writeFileSync(path.join(previewDir, `icon-${p.size}.png`), p.data)
      console.log(`預覽圖已存到 ${previewDir}`)
    }
  } catch (err) {
    console.error('產生圖示失敗：', err)
    process.exitCode = 1
  } finally {
    win.destroy()
    app.quit()
  }
})
