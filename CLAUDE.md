# Monitor-CPU 專案規範

Windows 工具列上的吉祥物（目前是螃蟹），CPU / GPU 負載越高跑得越快、顏色越紅。Electron 應用程式，打包成免安裝的 portable exe。功能與結構說明見 [README.md](README.md)。

## 語言

- 回覆、程式裡的 UI 文字、註解、README、commit 訊息一律使用**繁體中文**。

## 修改範圍

- **所有改動只能在這個專案資料夾（`Monitor-CPU/`）裡面。** 不要建立、修改或刪除專案外的檔案。
- 暫存檔、測試腳本、截圖等放在專案內的 `.tmp/`（已被 git 忽略），不要放到系統暫存目錄或其他地方。
- 安裝或移除軟體、修改登錄檔、改全域 git 設定、改系統設定這類專案外的變更，**一律先詢問**。
- 例外：為了測試而執行 app 本身時，app 照設計會寫入 `%APPDATA%\Monitor-CPU\settings.json` 與自己的系統匣登錄檔紀錄，這是可以的。
- 例外：Claude 的記憶檔（`~/.claude/projects/<此專案>/memory/`）可以新增與更新。

## Commit 規範

- 訊息開頭一定要有 Conventional Commits 類型前綴：`feat:`、`fix:`、`refactor:`、`docs:`、`style:`、`test:`、`build:`、`chore:` 等。
- 標題與內文用繁體中文，內文用條列說明改了什麼、為什麼。
- **不要加 `Co-Authored-By` 或任何 AI 署名行。**
- 中文訊息先寫成檔案再用 `git commit -F <檔案>`；直接把中文放在 PowerShell 5.1 的參數裡可能會變亂碼。

## 可攜性（最重要的限制）

- 別台 Windows 電腦必須**直接打開 exe 就能用**，不需要安裝 Node、Python、驅動或任何東西。
- 不使用需要編譯的原生 npm 套件；硬體資訊抓不到時要顯示 N/A，不能讓程式失敗。
- 執行時不要依賴 asar 裡的檔案（例如 README），也不要依賴別台電腦可能沒有的程式或檔案關聯。
- 功能改完除了 `npm start`，也要用 `npm run dist` 打包後的 exe 驗證。

## 工作方式

- 長時間的背景工作（`npm install`、打包）要主動回報進行到哪一步，並提供紀錄檔路徑，讓使用者可以自己看。
- 使用者可能正在用電腦（例如玩遊戲），**不要模擬滑鼠或鍵盤操作**。驗證改用截圖、讀取視窗與設定狀態等不干擾輸入的方式，需要實際點擊的項目請使用者自己試。
- 使用者正在用電腦時，打包這類吃 CPU 的工作用最低優先權執行：`cmd.exe /c 'start "" /low /b /wait npm.cmd run dist'`。

## 開發環境注意事項

- 在 VS Code 的終端機裡，`ELECTRON_RUN_AS_NODE=1` 會讓 electron 退化成普通 Node。啟動前先執行 `$env:ELECTRON_RUN_AS_NODE = $null`。
- PowerShell 5.1 的 `Get-Content` / `Set-Content` 預設不是 UTF-8，會把中文檔案弄壞；修改檔案請用編輯器工具，不要用 PowerShell 讀寫。
- 關閉 app 時只結束本專案的 electron（依路徑過濾 `Monitor-CPU\node_modules\electron`），不要結束所有叫 electron 的程序。
- 打包後的 exe 也會被 `ELECTRON_RUN_AS_NODE=1` 影響（直接結束、沒有任何訊息），在 VS Code 終端機裡測 exe 前一樣要先清掉。
- 沒開 Windows「開發人員模式」時，electron-builder 解壓 winCodeSign 會因為 macOS 的符號連結失敗而打包失敗。做法：設 `$env:ELECTRON_BUILDER_CACHE = "$PWD\.tmp\eb-cache"`，用 `node_modules\7zip-bin\win\x64\7za.exe` 把 winCodeSign 的 7z 解到 `.tmp\eb-cache\winCodeSign\winCodeSign-2.6.0`（那兩個 darwin 檔案的錯誤可以忽略），再打包。
- `build.electronDist` 指向 `node_modules/electron/dist`，避免 electron-builder 的分段下載卡死，不要拿掉。
- exe 圖示由 `npm run icon` 從 `src/renderer/crab.js` 產生；改了吉祥物長相要重新產生。
