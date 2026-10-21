'use strict'

const api = window.settingsAPI
let state = null

/**
 * 有哪些吉祥物，以及設定視窗上的說明。新增動物時在這裡加一筆（主程序的 MASCOTS 也要加），
 * 沒寫的說明會用 DEFAULT_TEXT。
 */
const MASCOTS = [
  {
    id: 'crab',
    name: '螃蟹',
    roamOn: '沿著螢幕四周爬：爬上牆壁、倒掛在天花板上',
    roamOff: '關掉的話只在底下的工具列上橫著走',
    perchTitle: '爬到其他視窗上',
    perch: '爬到視窗正上方再跳下去，之後沿著視窗四周爬',
  },
  {
    id: 'bird',
    name: '小鳥',
    roamOn: '在畫面上飛來飛去，累了就找地方停',
    roamOff: '關掉的話只在底下的工具列上走走跳跳',
    perchTitle: '停在其他視窗的標題列上',
    perch: '視窗移動時會跟著走，視窗關掉或被蓋住就飛走',
  },
  {
    id: 'bear',
    name: '台灣黑熊',
    roamOn: '沿著螢幕四周爬：爬上牆壁、抓著天花板倒掛',
    roamOff: '關掉的話只在底下的工具列上慢慢走',
    perchTitle: '爬到其他視窗上',
    perch: '爬到視窗正上方再跳下去，之後沿著視窗四周爬',
  },
]

const DEFAULT_TEXT = {
  roamOn: '在整個畫面上活動',
  roamOff: '關掉的話只在底下的工具列上活動',
  perchTitle: '可以到其他視窗上',
  perch: '視窗移動時會跟著走，視窗關掉或被蓋住就離開',
}

const mascotText = (id) => ({ ...DEFAULT_TEXT, ...(MASCOTS.find((m) => m.id === id) || {}) })

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => Array.from(document.querySelectorAll(sel))

async function change(patch) {
  const res = await api.update(patch)
  // 不被接受的變更（例如吉祥物和小圖示同時關掉）：畫面還原成主程序的狀態
  render(res.state)
}

function render(next) {
  state = next
  const c = state.config

  $('#version').textContent = `v${state.version}`

  for (const seg of $$('[data-key].seg, [data-key].choices')) {
    for (const b of seg.querySelectorAll('button')) {
      const on = String(c[seg.dataset.key]) === b.dataset.value
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))
    }
  }

  for (const box of $$('input[type=checkbox][data-key]')) box.checked = !!c[box.dataset.key]

  const scale = $('#scale')
  if (document.activeElement !== scale) scale.value = String(c.scale)
  $('#scale-out').textContent = `${Math.round(Number(scale.value) * 100)}%`

  // 活動範圍：每種吉祥物共用同一個開關，說明跟著角色換
  const text = mascotText(c.mascot)
  $('#roam-desc').textContent = c.roamScreen ? text.roamOn : text.roamOff
  $('#perch-title').textContent = text.perchTitle
  $('#perch-desc').textContent = text.perch
  const perchRow = $('#perch-row')
  const perchOk = !!c.roamScreen
  perchRow.style.opacity = perchOk ? '' : '0.45'
  perchRow.querySelector('input').disabled = !perchOk

  // 吉祥物和小圖示至少要留一個
  const crabLocked = c.showCrab && !c.showTray
  const trayLocked = c.showTray && !c.showCrab
  lock('showCrab', crabLocked, '至少要留一個：右下角小圖示關掉時，吉祥物不能關')
  lock('showTray', trayLocked, '至少要留一個：吉祥物關掉時，小圖示不能關')
  if (!crabLocked) $('#showCrab-note').textContent = '關掉的話只剩右下角的小圖示'
  if (!trayLocked) $('#showTray-note').textContent = '關掉的話，在吉祥物身上按右鍵叫出選單'

  const select = $('#display')
  const current = c.displayId === null ? (state.displays.find((d) => d.primary) || {}).id : c.displayId
  select.replaceChildren(
    ...state.displays.map((d) => {
      const o = document.createElement('option')
      o.value = String(d.id)
      o.textContent = d.label
      o.selected = d.id === current
      return o
    })
  )
  select.disabled = state.displays.length < 2

  renderMetrics(state.metrics)
}

function lock(key, locked, note) {
  const box = $(`input[data-key=${key}]`)
  box.disabled = locked
  box.closest('.check').classList.toggle('locked', locked)
  if (locked) $(`#${key}-note`).textContent = note
}

function renderMetrics(m) {
  if (!m) return
  meter('cpu', m.cpu && m.cpu.load, m.cpu && m.cpu.temp)
  meter('gpu', m.gpu && m.gpu.load, m.gpu && m.gpu.temp)
}

function meter(id, load, temp) {
  const has = (v) => v !== null && v !== undefined && !Number.isNaN(v)
  const value = has(load) ? `${Math.round(load)}%` : 'N/A'
  $(`#${id}-value`).textContent = has(temp) ? `${value} · ${Math.round(temp)}°C` : value
  const bar = $(`#${id}-bar`)
  const pct = has(load) ? Math.max(0, Math.min(100, load)) : 0
  bar.style.width = `${pct}%`
  // 跟吉祥物一樣：青色 → 紅色
  bar.style.setProperty('--hue', String(Math.round(186 - pct * 1.86)))
}

// ---------------------------------------------------------------- 事件

// 角色按鈕由 MASCOTS 產生，要在綁定點擊事件之前建好
$('#mascots').replaceChildren(
  ...MASCOTS.map((m) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.value = m.id
    b.textContent = m.name
    return b
  })
)

for (const seg of $$('[data-key].seg, [data-key].choices')) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]')
    if (!b) return
    change({ [seg.dataset.key]: b.dataset.value })
  })
}

for (const box of $$('input[type=checkbox][data-key]')) {
  box.addEventListener('change', () => change({ [box.dataset.key]: box.checked }))
}

const scale = $('#scale')
scale.addEventListener('input', () => {
  $('#scale-out').textContent = `${Math.round(Number(scale.value) * 100)}%`
  change({ scale: Number(scale.value) })
})

$('#display').addEventListener('change', (e) => change({ displayId: Number(e.target.value) }))
$('#temp-help').addEventListener('click', () => api.temperatureHelp())
$('#quit').addEventListener('click', () => api.quit())

api.onState(render)
api.onMetrics(renderMetrics)
api.get().then((s) => {
  render(s)
  window.scrollTo(0, 0)
})
