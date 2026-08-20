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
| 台灣福祉 | AI-TWBRAUN | 1 列 3 欄 | 3 | `taiwanhomecare/`（大版＋半高版）|
| 鮮湧 | 鮮湧AI客服 | 3 欄 × 2 列 | 6 | `shianyong/`（僅大版，見下）|
| aiproot | aiproot | — | 3 | 目前直接沿用台灣福祉那張背景圖，只是區塊網址帶自己的 `botId`／`liffId` |

### 鮮湧 6 宮格 · 每一格接什麼

| # | 標籤 | 現況 | 要接什麼 |
|--:|---|---|---|
| 1 | 打卡 | ✅ 頁面已上線 | `?page=punch` |
| 2 | 我的行程 | ✅ 頁面已上線 | `?page=trips` |
| 3 | 我的日報 | ✅ 頁面已上線 | `?page=mine` |
| 4 | 報工單 | ⚠️ **沒有對應頁面** | LIFF 只認得 `mine` / `punch` / `trips`（`web/src/liff/main.tsx:100`）· 要嘛新增一個 page、要嘛先指到 Ragic 表單網址 |
| 5 | 智慧聯網戰情室 | ⚠️ 有網站、但不是 LIFF | 戰情室是一般網頁（`https://ai-center-line-demo.onrender.com/`）· 用 URI 動作直接開即可，不需要 LIFF |
| 6 | 內部客服機器人 | 🔒 **預寫、尚未開放** | 背景圖上刻意畫成**灰階＋「尚未開放」**，避免有人照著去接動作。要上線時先改圖再設區塊 |

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

## LINE 的硬限制

| 項目 | 值 |
|---|---|
| 允許尺寸 | 2500×1686、2500×843、1200×810、1200×405、800×540、800×270 |
| 檔案大小 | **≤ 1 MB**（目前兩張都在 130 KB 以內，有很大餘裕）|
| 格式 | JPEG / PNG |
| 可點區塊數 | API 最多 20 個；但走 manager.line.biz 後台只能挑內建版型 |

來源：[Rich menus overview](https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/)
