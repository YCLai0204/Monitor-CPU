'use strict'

const api = window.settingsAPI
let state = null

/** 角色下拉選單的分區，照這個順序排。 */
const GROUPS = [
  { id: 'sky', name: '天上' },
  { id: 'water', name: '水裡' },
  { id: 'land', name: '地上' },
]

/**
 * 有哪些吉祥物，以及設定視窗上的說明。新增動物時在這裡加一筆（主程序的 MASCOTS 也要加），
 * group 是放在下拉選單的哪一區（GROUPS），沒寫的說明會用 DEFAULT_TEXT。
 */
const MASCOTS = [
  {
    id: 'crab',
    group: 'land',
    name: '螃蟹',
    roamOn: '沿著螢幕四周爬：爬上牆壁、倒掛在天花板上',
    roamOff: '關掉的話只在底下的工具列上橫著走',
    perchTitle: '爬到其他視窗上',
    perch: '爬到視窗正上方再跳下去，之後沿著視窗四周爬',
  },
  {
    id: 'bird',
    group: 'sky',
    name: '小鳥',
    roamOn: '在畫面上飛來飛去，累了就找地方停',
    roamOff: '關掉的話只在底下的工具列上走走跳跳',
    perchTitle: '停在其他視窗的標題列上',
    perch: '視窗移動時會跟著走，視窗關掉或被蓋住就飛走',
  },
  {
    id: 'bear',
    group: 'land',
    name: '台灣黑熊',
    roamOn: '沿著螢幕四周走：扒著牆往上爬，但不會倒掛',
    roamOff: '關掉的話只在底下的工具列上走',
    perchTitle: '爬到其他視窗上',
    perch: '從視窗側邊爬上去坐；沒被移動的視窗上還會冒出食物',
  },
  {
    id: 'spoonbill',
    group: 'sky',
    name: '黑面琵鷺',
    roamOn: '在畫面上飛來飛去，累了就找地方停',
    roamOff: '關掉的話只在底下的工具列上走走、用湯匙嘴掃來掃去',
    perchTitle: '停在其他視窗的標題列上',
    perch: '視窗移動時會跟著走，視窗關掉或被蓋住就飛走',
  },
  {
    id: 'turtle',
    group: 'water',
    name: '綠蠵龜',
    roamOn: '把整個畫面當成海慢慢游，累了回到工具列的淺水裡休息',
    roamOff: '關掉的話在工具列上爬，偶爾下到淺水裡游',
    noWindows: true, // 水生動物不會到其他視窗上
    perchTitle: '到其他視窗上',
    perch: '綠蠵龜是水生動物，不會到其他視窗上',
  },
  {
    id: 'pangolin',
    group: 'land',
    name: '台灣穿山甲',
    roamOn: '沿著螢幕四周走：用爪子扒著牆往上爬，但不會倒掛',
    roamOff: '關掉的話只在底下的工具列上走',
    perchTitle: '爬到其他視窗上',
    perch: '從視窗側邊爬上去趴著；沒被移動的視窗上還會冒出白蟻窩',
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

  $('#mascot').value = c.mascot

  const scale = $('#scale')
  if (document.activeElement !== scale) scale.value = String(c.scale)
  $('#scale-out').textContent = `${Math.round(Number(scale.value) * 100)}%`

  // 活動範圍：每種吉祥物共用同一個開關，說明跟著角色換
  const text = mascotText(c.mascot)
  $('#roam-desc').textContent = c.roamScreen ? text.roamOn : text.roamOff
  $('#perch-title').textContent = text.perchTitle
  $('#perch-desc').textContent = text.perch
  const perchRow = $('#perch-row')
  const perchOk = !!c.roamScreen && !text.noWindows // 水生動物不會到其他視窗上
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

  renderRender(state.render)
  renderMetrics(state.metrics)
}

const RENDER_NAME = { cpu: '省 GPU（用 CPU 繪圖）', gpu: '用顯示卡繪圖' }

/** 繪圖方式的說明：這台電腦自動會選哪一種、為什麼，以及什麼情況建議換另一種。 */
function renderRender(r) {
  if (!r) return
  const why = r.cores >= r.minCores
    ? `這台電腦有 ${r.cores} 個邏輯核心，CPU 多用一點幾乎感覺不到，所以自動選「${RENDER_NAME.cpu}」。`
    : `這台電腦只有 ${r.cores} 個邏輯核心，改用 CPU 繪圖會比較吃力，所以自動選「${RENDER_NAME.gpu}」。`
  const lines = [
    `目前使用：${RENDER_NAME[r.active]}`,
    why,
    '・省 GPU：GPU 大約再省一半，CPU 稍微多用一點，適合核心多的電腦、或打遊戲時想把顯示卡留給遊戲。',
    '・用顯示卡：CPU 用得最少，適合入門款筆電；用電池時覺得耗電也可以試試這個。',
  ]
  $('#render-info').textContent = lines.join('\n')
  $('#relaunch-row').hidden = r.next === r.active
  $('#relaunch').textContent = `重新啟動，改用「${RENDER_NAME[r.next]}」`
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

// 角色下拉選單由 MASCOTS 產生，依 GROUPS 分成天上、水裡、地上幾區
$('#mascot').replaceChildren(
  ...GROUPS.map((g) => {
    const group = document.createElement('optgroup')
    group.label = g.name
    for (const m of MASCOTS.filter((m) => m.group === g.id)) {
      const o = document.createElement('option')
      o.value = m.id
      o.textContent = m.name
      group.append(o)
    }
    return group
  }).filter((group) => group.children.length)
)
$('#mascot').addEventListener('change', (e) => change({ mascot: e.target.value }))

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
$('#relaunch').addEventListener('click', () => api.relaunch())

api.onState(render)
api.onMetrics(renderMetrics)
api.get().then((s) => {
  render(s)
  window.scrollTo(0, 0)
})
