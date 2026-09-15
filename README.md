# Monitor-CPU

一隻在工具列上爬來爬去的吉祥物（目前是 🦀 螃蟹）。**CPU / GPU 負載越高，牠就跑得越快、顏色也從青色越變越紅。**

- 0% → 青色，慢慢晃、偶爾停下來吐泡泡
- 50% → 黃綠色，穩定地橫著走
- 100% → 全紅、腳踩得飛快，身上還會冒熱氣

滑鼠移到螃蟹身上會顯示即時數值，**左鍵**戳牠會嚇跑牠（並固定顯示數值），**右鍵**螃蟹或點右下角的小螃蟹圖示可以叫出選單。其他時候整個視窗都是穿透的，不會擋到你原本的工具列。

右下角的小圖示也是一隻螃蟹，會像 OneDrive 的雲一樣直接顯示在時鐘旁邊，顏色一樣跟著負載從青色變紅色。

---

## 需要什麼

只需要 [Node.js](https://nodejs.org/)（18 以上）。**不需要 Python、不需要編譯器、不需要管理員權限，也沒有任何原生套件要編譯** —— 這是刻意的，為了讓它在大部分電腦上都裝得起來。

## 怎麼跑

```bash
npm install
npm start
```

## 打包成單一 exe（給沒裝 Node 的電腦用）

```bash
npm run dist
```

產生的 `dist\Monitor-CPU <版本>.exe`（約 70 MB）是免安裝的可攜檔，複製到別台 Windows 電腦上雙擊就能跑，那台電腦不需要裝 Node 或任何東西。exe 的圖示就是螃蟹。

> `build.electronDist` 特意指向 `node_modules/electron/dist`。electron-builder 預設會再去 GitHub 抓一份 115MB 的 Electron，而它的 8 執行緒分段下載器在某些網路環境會整個卡死（而且不會逾時重試）。`npm install` 早就把同版本抓好了，直接用現成的既快又不會卡。

### 圖示

exe 圖示 `build/icon.ico` 是從 `src/renderer/crab.js` 的畫法產生的，跟工具列上那隻是同一份。改了螃蟹長相之後重新產生：

```bash
npm run icon
```

32px 以下的尺寸會自動改用線條較粗、省略細節的畫法，否則在檔案總管的小圖示裡會糊成一團。

---

## 選單裡有什麼

右鍵點螃蟹，或點右下角的小螃蟹圖示：

| 項目 | 說明 |
| --- | --- |
| 監看來源 | 決定螃蟹的速度與顏色要跟著 **CPU**、**GPU**、還是**兩者取較高** |
| 螃蟹大小 | 小 / 中 / 大 |
| 顯示數值標籤 | 是否一直顯示頭上的數值氣泡（關掉的話滑鼠移過去才會出現） |
| 顯示在螢幕 | 多螢幕時決定螃蟹要待在哪一台 |
| 在桌面顯示螃蟹 | 關掉的話工具列上就不會有螃蟹，只剩右下角的小圖示 |
| 在右下角顯示小圖示 | 關掉的話右下角就沒有圖示，選單改從螃蟹身上按右鍵叫出 |
| 開機時自動啟動 | 登入 Windows 後自動跑起來 |
| 溫度顯示 N/A？ | 說明為什麼沒有溫度，以及怎麼補上 |

設定會存在 `%APPDATA%\Monitor-CPU\settings.json`。改名前的舊設定（`%APPDATA%\crab-monitor`）會在第一次啟動時自動複製過來。

### 螃蟹和小圖示不能同時關掉

這兩個是唯二能叫出選單的地方，全關掉就再也找不到設定了。所以只剩一個開著的時候，那一項會變成灰色並標示「至少要留一個」。

萬一還是找不到（例如手動改壞了設定檔），**再執行一次 exe 就會把螃蟹和小圖示兩個都叫回來**，不會多開第二隻。

### 小圖示為什麼會直接顯示，而不是藏在 `^` 箭頭裡

Windows 11 預設會把新程式的系統匣圖示收進 `^` 箭頭，要自己到「設定 → 個人化 → 工作列 → 其他系統匣圖示」打開。那個開關其實存在登錄檔 `HKCU\Control Panel\NotifyIconSettings` 的 `IsPromoted`。

小圖示第一次出現時，程式會幫**自己的**那一筆打開，效果跟你在 Windows 設定裡手動打開一樣，不會動到其他程式的圖示。每個 exe 位置只會自動打開一次，之後你若在 Windows 設定裡把它收回去，程式會尊重你的選擇，不會再蓋掉。

Windows 10 用的是另一種格式，這個功能不會生效，要自己把圖示拖到工作列上。

---

## 數據是從哪裡來的

這是這個專案唯一比較麻煩的部分，所以分成好幾層，抓得到哪層就用哪層：

| 數據 | 來源 | 相容性 |
| --- | --- | --- |
| **CPU 使用率** | Node 內建的 `os.cpus()` 時間差 | ✅ 所有電腦、所有平台都可以 |
| **GPU 使用率** | ① `nvidia-smi`（有 N 卡就用）<br>② LibreHardwareMonitor 的 WMI<br>③ Windows 內建的 `GPU Engine` 效能計數器 | ✅ Win10/11 幾乎都有第 ③ 層，NVIDIA / AMD / Intel 通吃 |
| **CPU 溫度** | ① LibreHardwareMonitor 的 WMI<br>② ACPI 熱區 `MSAcpi_ThermalZoneTemperature` | ⚠️ 見下方說明 |
| **GPU 溫度** | ① `nvidia-smi`<br>② LibreHardwareMonitor 的 WMI | ✅ N 卡沒問題，其他卡見下方說明 |

效能計數器的名稱會隨 Windows 語言在地化（中文版叫「GPU 引擎」），所以程式會先去登錄檔 `Perflib` 把英文名字翻成當地名字再查，中文版 Windows 一樣抓得到。

### `npm start` 出現 `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`

你八成是在 **VS Code 的整合式終端機**裡跑的。VS Code 會設一個 `ELECTRON_RUN_AS_NODE=1` 環境變數並傳給子程序，它會讓 electron 退化成普通的 Node，`require('electron')` 就拿不到模組。清掉它再跑：

```powershell
$env:ELECTRON_RUN_AS_NODE = $null
npm start
```

換一個獨立的 PowerShell 視窗跑也可以。打包出來的 exe 不受影響。

### 為什麼溫度顯示 N/A？

因為 **Windows 本身沒有提供通用的 CPU/GPU 溫度介面**。筆電通常有 ACPI 熱區可以讀，桌上型電腦的溫度多半只能透過主機板晶片直接讀取，這件事需要核心層驅動。

想看到溫度的話，裝並執行 [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)（免費開源）就好：

1. 下載後執行 `LibreHardwareMonitor.exe`
2. 到 `Options` → 勾選 **Remote Web Server 下方的 `WMI Provider`**
3. 讓它留在背景（可以縮到系統匣）

Monitor-CPU 會自動偵測到它開的 WMI namespace 並改用它的數據，**不用重開**，下一次取樣（約 2 秒）就會出現溫度。

> 注意：使用率不受影響，就算完全不裝 LibreHardwareMonitor，CPU 與 GPU 的使用率照樣正常運作，螃蟹也照樣會變色變快。

---

## 專案結構

```
src/
  main/
    main.js        Electron 主程序：置頂穿透視窗、系統匣、選單、設定
    metrics.js     取樣邏輯（CPU 用純 JS，其餘交給 probe）
    probe.ps1      常駐的 PowerShell 取樣程序，每 2 秒吐一行 JSON
    tray-icon.js   備用的點陣系統匣圖示（Canvas 版還沒畫好或畫失敗時才用）
  preload/
    preload.js     contextBridge，只開放需要的幾個方法
  renderer/
    index.html
    style.css
    crab.js        螃蟹的 Canvas 畫法（身體、螯、腳、眼柄、熱氣），也負責產生圖示
    app.js         移動邏輯、步伐節奏、數值標籤、滑鼠命中判定
scripts/
  make-icon.js     用 crab.js 產生 build/icon.ico
build/
  icon.ico         exe 圖示（16–256px）
  icon.png         256px 預覽
```

視窗是一條跨滿整個螢幕寬度、高 130px 的透明視窗，貼在螢幕最底部並用 `screen-saver` 層級蓋在工具列上方；平常整片 `setIgnoreMouseEvents(true)` 讓點擊穿透到工具列，只有游標真的壓在螃蟹身上時才短暫接管滑鼠。

系統匣圖示會在螃蟹視窗載入後，用同一份 `crab.js` 一次畫好 21 種顏色（每 5% 一種）× 3 種解析度（16 / 24 / 32px）快取起來，所以跟工具列上的螃蟹長得一樣。
