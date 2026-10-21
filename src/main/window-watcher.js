'use strict'

const { EventEmitter } = require('events')
const { spawn } = require('child_process')

const INTERVAL_MS = 200

/**
 * 常駐的 PowerShell：用 Windows 內建的 user32 / dwmapi 列出畫面上的其他視窗（只排除吉祥物那片透明視窗，
 * 設定視窗也算，因為它一樣會擋住其他視窗），
 * 給小鳥找可以停的標題列。沒有原生 npm 套件，Add-Type 用的是每台 Windows 都有的 .NET Framework。
 *
 * 輸出依 z-order（最上面的在前）每行一個 JSON 陣列，每個視窗是 [hwnd, left, top, right, bottom]，
 * 座標是實體像素（程序設成 Per-Monitor DPI aware），換成 Electron 的 DIP 交給呼叫端。
 * 跟上一次一樣就不輸出，視窗沒動時幾乎不花資源。
 */
const SOURCE = String.raw`
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class MonitorCpuWindows {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);

  public static void Init() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
  }

  public static string List(long self) {
    var sb = new StringBuilder("[");
    bool first = true;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      // 只排除吉祥物那片透明視窗；設定視窗也會擋住其他視窗，要照實際的前後順序算進去
      if (h.ToInt64() == self) return true;
      int ex = GetWindowLong(h, -20);
      if ((ex & 0x80) != 0 || (ex & 0x20) != 0) return true; // 工具視窗、穿透的浮層
      int cloaked;
      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true; // 其他桌面、背景的 UWP
      if (GetWindowTextLength(h) == 0) return true;
      var cls = new StringBuilder(64);
      GetClassName(h, cls, 64);
      string c = cls.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
      RECT r;
      // 擴充外框才是看得到的邊；GetWindowRect 會多算 Windows 10 以後看不見的拖曳邊框
      if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) GetWindowRect(h, out r);
      if (r.R - r.L < 120 || r.B - r.T < 60) return true;
      if (!first) sb.Append(',');
      first = false;
      sb.Append('[').Append(h.ToInt64()).Append(',').Append(r.L).Append(',').Append(r.T)
        .Append(',').Append(r.R).Append(',').Append(r.B).Append(']');
      return true;
    }, IntPtr.Zero);
    return sb.Append(']').ToString();
  }
}
`

const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `Add-Type -TypeDefinition @'\n${SOURCE}\n'@`,
  '[MonitorCpuWindows]::Init()',
  '$self = [int64]$env:MONITOR_CPU_HWND',
  "$last = ''",
  'while ($true) {',
  '  $s = [MonitorCpuWindows]::List($self)',
  '  if ($s -ne $last) { [Console]::Out.WriteLine($s); [Console]::Out.Flush(); $last = $s }',
  `  Start-Sleep -Milliseconds ${INTERVAL_MS}`,
  '}',
].join('\n')

class WindowWatcher extends EventEmitter {
  constructor() {
    super()
    this.excludeHwnd = '0' // 吉祥物視窗的 HWND（十進位字串），不算在「其他視窗」裡
    this._child = null
    this._running = false
    this._failures = 0
    this._restartTimer = null
  }

  get running() {
    return this._running
  }

  start() {
    if (this._running || process.platform !== 'win32') return
    this._running = true
    this._spawn()
  }

  stop() {
    if (!this._running) return
    this._running = false
    clearTimeout(this._restartTimer)
    if (this._child) {
      this._child.removeAllListeners()
      try { this._child.kill() } catch (_) { /* 已經結束了 */ }
      this._child = null
    }
    this.emit('windows', [])
  }

  _spawn() {
    let child
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')],
        { windowsHide: true, env: { ...process.env, MONITOR_CPU_HWND: this.excludeHwnd } }
      )
    } catch (_) {
      return
    }
    this._child = child

    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        try {
          const list = JSON.parse(line)
          this._failures = 0
          this.emit('windows', list.map(([id, l, t, r, b]) => ({ id: String(id), l, t, r, b })))
        } catch (_) { /* 壞掉的一行就跳過 */ }
      }
      if (buffer.length > 256 * 1024) buffer = ''
    })
    child.stderr.on('data', () => {})
    child.on('exit', () => {
      this._child = null
      if (!this._running) return
      // 掛掉就重開；一直失敗（例如被防毒擋掉 Add-Type）就慢慢放棄，小鳥只是不能停在視窗上
      this._failures++
      if (this._failures > 5) return
      this._restartTimer = setTimeout(() => this._spawn(), 3000 * this._failures)
    })
  }
}

module.exports = { WindowWatcher }
