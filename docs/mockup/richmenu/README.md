# 圖文選單背景圖 · 依租戶分資料夾

LINE 的圖文選單是「**一張背景圖 ＋ 在圖上框可點區塊**」。按鈕文字是**畫在圖上**的，
所以**每家公司開的功能不同 → 背景圖就不同**，不能共用一張。故以租戶為單位分資料夾。

設定步驟（選版型、框區塊、貼網址）見 [`../../sop/richmenu-attendance-setup.md`](../../sop/richmenu-attendance-setup.md)。
這裡只放素材與產圖方式。

```
richmenu/
├── README.md                        ← 本檔
├── taiwanhomecare/                  ← 台灣福祉（AI-TWBRAUN）· 3 欄
│   ├── menu.html                    ← 原始檔（改這個，不要改 PNG）
│   ├── richmenu-large-2500x1686.png
│   └── richmenu-compact-2500x843.png
└── shianyong/                       ← 鮮湧（鮮湧AI客服）· 6 宮格
    ├── menu.html
    └── richmenu-large-2500x1686.png
```

> **資料夾名用租戶英文代號**（`taiwanhomecare` / `shianyong`），對齊 `data/*.json`
> 與 `docs/modules/sales-worklog-shianyong.md` 的既有寫法。
> ⚠️ 程式碼裡 `server/src/notify/tenant.registry.ts` 寫的是 `xianyong: "鮮勇"`（勇），
> 文件與客戶自稱是「鮮**湧**」—— 兩個字並存是既有狀態，本次不動，但接新東西前值得統一。

---

## 各家現況

| 租戶 | 官方帳號 | 版面 | 格數 | 檔案 |
|---|---|---|--:|---|
| 台灣福祉 | AI-TWBRAUN | 1 列 3 欄 | 3 | `taiwanhomecare/`（大版＋半高版）· 中文 |
| 鮮湧 | 鮮湧AI客服 | 2 欄 × 2 列 | 4 | `shianyong/`（僅大版，見下）· **中英雙語**（2026-08-28）|
| aiproot | aiproot | — | 3 | 目前直接沿用台灣福祉那張背景圖，只是區塊網址帶自己的 `botId`／`liffId` |

### 鮮湧 4 宮格 · 每一格接什麼

> **2026-08-20 由 6 宮格改為 4 宮格** —— 用戶要求先隱藏「打卡」與「我的行程」（鮮湧本期不導入外勤功能）。
> ⚠️ **只換背景圖不算隱藏** —— 圖文選單的可點區塊是獨立設定的，
> 版型若還留著 6 區塊，使用者點原本打卡的位置**照樣會開啟 LIFF 打卡頁**（圖上看不出那裡可以點，更難察覺）。
> 換圖時**必須一併把版型改成 4 區塊**。

| # | 標籤 | 現況 | 要接什麼 |
|--:|---|---|---|
| 1 | 報工單 / Work Log | ⚠️ **沒有對應頁面** | LIFF 只認得 `mine` / `punch` / `trips`（`web/src/liff/main.tsx:100`）· 要嘛新增一個 page、要嘛先指到 Ragic 表單網址 |
| 2 | 我的日報 / My Daily Report | ✅ 頁面已上線 | `?page=mine` |
| 3 | 智慧聯網戰情室 / Ops Command Center | ✅ 已上線 | 一般網頁，非 LIFF：`https://ai-center-line-demo.onrender.com/shianyong-warroom.html`（平面圖監控＋批次品質＋巡檢三個分頁）· 用 URI 動作直接貼，不帶 `botId`／`liffId` |
| 4 | 內部客服機器人 / Internal Support Bot | 🔒 **預寫、尚未開放** | 背景圖上刻意畫成**灰階＋「尚未開放・Coming Soon」**，避免有人照著去接動作。要上線時先改圖再設區塊 |

### ⚠️⚠️ 選單有英文，不代表點進去有英文

2026-08-28 鮮湧選單改中英雙語。**但選單只是入口，目的地是另一回事** ——
一個看不懂中文的人照著 `My Daily Report` 點進去，如果落地是一片中文，
那比選單全中文更糟：**我們主動承諾了一件做不到的事**。

四個目的地的實際語言狀態：

| # | 目的地 | 英文？ | 說明 |
|--:|---|:-:|---|
| 1 | 報工單 | — | 還沒有頁面 |
| 2 | 我的日報（LIFF `?page=mine`）| ✅ **有** | 複用 `personal-report/MyDailyReport`，已在 i18n 甲案內翻好；LINE webview 會依手機語言自動判斷 |
| 2b | └ LIFF 外殼（`liff/main.tsx`）| ❌ **沒有** | 頁首標題與 5 個錯誤訊息仍是中文（「LIFF SDK 未載入」「缺 botId」「尚未綁定」…）· `liff/` 整個目錄在 i18n 甲案範圍外 |
| 3 | 智慧聯網戰情室 | ❌ **沒有** | `shianyong-warroom.html` 全中文（112 行）· 靜態頁，不吃 web app 的 i18n |
| 4 | 內部客服機器人 | — | 未開放 |

> **要補的話是兩件獨立的事**：
> ① `liff/` 接 i18n（12 條字串，小）
> ② `shianyong-warroom.html` 雙語化 —— 那頁**同時排在視覺改版**
>    （[`smart-inspection`](../../modules/smart-inspection.md) →
>    [`shianyong-warroom-redesign`](../../modules/shianyong-warroom-redesign.md)），
>    **建議跟改版一起做，不要分兩次動同一個檔案。**

**已隱藏（頁面仍在，只是選單不放）**：打卡 `?page=punch`、我的行程 `?page=trips`。
⚠️ 這兩頁**沒有英文**（`liff/PunchView.tsx`、`personal-report/MyTrips` 的 LIFF 用法）——
之後若要恢復進選單，雙語標籤要連同頁面一起評估。
要恢復的話 `menu.html` 改回 3×2、重產圖、版型換回 6 區塊即可，後端不必動。

> ⚠️ **4／5／6 貼上去之前要先確認網址真的開得起來。**
> 圖文選單的區塊是「圖上的一塊範圍」，貼錯網址不會有任何錯誤提示 ——
> 使用者按下去只會開出一個壞掉的頁面，而我們這邊完全不會知道。

### 為什麼鮮湧只有大版、沒有半高版

半高版（2500×843）切成 6 格後每格只剩約 421px 高，字會擠在一起。
另外 LINE 後台的半高版型有沒有提供 6 區塊的選項，**我沒有查證到**，
不想憑印象寫進文件 —— 真要做半高版，先去 manager.line.biz 的版型清單確認一次。

---

## 改圖 / 產圖

**改 `menu.html`，不要改 PNG。** PNG 是產物，用 headless Chrome 重新截圖：

```bash
cd docs/mockup/richmenu/<租戶>
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --allow-file-access-from-files \
  --force-device-scale-factor=1 --window-size=2500,1686 \
  --screenshot=richmenu-large-2500x1686.png "file://$PWD/menu.html"
```

半高版（僅台灣福祉那種 3 欄版有）：`--window-size=2500,843`，
並在網址後加 `?size=compact`，輸出檔名 `richmenu-compact-2500x843.png`。

⚠️ `--force-device-scale-factor=1` 不可省 —— Retina 機器預設 2x，
截出來會是 5000×3372，LINE 直接拒收。產完用 `file *.png` 確認尺寸。

### 雙語版的兩個排版重點（鮮湧 2026-08-28）

| | 做法 | 為什麼 |
|---|---|---|
| 字體堆疊 | `.en` / `.cap` 把**拉丁字型排在 CJK 之前** | 只寫 `PingFang TC` / `Noto Sans TC` 的話，英文會用它們的拉丁字符，字重與字距明顯偏弱 —— 在 2500px 的圖上一眼看得出來 |
| 字級 | 中文 84px、**英文 50px**（小一階）| 這是給台灣工廠現場看的選單，**中文是主、英文是輔**。兩行等大會讓中文使用者多花時間找自己要看的那行 |

排版驗證（Playwright 量測，非目測）：四格皆**上下留白各 178px 完全置中**，
最寬一行 609px vs 可用寬 1170px，**無溢出**。

## LINE 的硬限制

| 項目 | 值 |
|---|---|
| 允許尺寸 | 2500×1686、2500×843、1200×810、1200×405、800×540、800×270 |
| 檔案大小 | **≤ 1 MB**（目前兩張都在 130 KB 以內，有很大餘裕）|
| 格式 | JPEG / PNG |
| 可點區塊數 | API 最多 20 個；但走 manager.line.biz 後台只能挑內建版型 |

來源：[Rich menus overview](https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/)
