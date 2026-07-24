# 圖文選單 + 外勤打卡上線 SOP

> 在 LINE 官方帳號設「圖文選單」讓員工一鍵開 LIFF 打卡／我的日報，並把外勤定位里程功能開起來。
>
> 版本：v1.0（2026-07-24）｜對應：ai-center-line attendance-location-mileage M1+M2

---

## 名詞先分清（很多人卡在這）

| 名稱 | 是什麼 | 在哪設 |
|---|---|---|
| **圖文選單（Rich Menu）** | 聊天室**底部常駐**的按鈕面板 ✅ 我們要的 | LINE Official Account Manager（manager.line.biz）→ 聊天室相關 → 圖文選單 |
| ~~圖文訊息（Rich Message）~~ | 聊天裡發送的大圖訊息 ❌ 不是這個 | 訊息項目 → 圖文訊息 |
| ~~Callback URL~~ | 「以 LINE 登入」OAuth 用 ❌ 無關 | LINE Developers → LINE Login channel |

---

## 前置條件（先確認，否則按鈕點了會失敗）

- [ ] **程式已部署**（前後端 push 到 prod 且 Render 部署完成）。
- [ ] **prod 已跑兩條 migration**：`0023_attendance.sql`、`0024_map_routing_config.sql`。
- [ ] **LIFF endpoint 已指向 `/liff.html`**（現有 LIFF `2010801742-WBQkAv5t`；先前 LIFF 收斂已切）。
- [ ] **地圖 key 已設**（見下方 Part A；沒設也能打卡，只是里程先留空白）。

---

## Part A · 設定里程 key（aiproot 端，一次性）

外勤逐段里程＝**真實道路路線距離**（沿實際道路，像 Google Maps 點到點），由「里程計算 provider」算。**本專案採 Google Routes**（2026-07-25 用戶裁定）。

1. **Google Cloud 設定**（一次性）：
   - 到 console.cloud.google.com 建立/選專案 → **啟用計費**（綁信用卡帳號）。
   - API 與服務 → 啟用 **Routes API**（算道路距離 + 路線折線）。
   - 選配：啟用 **Geocoding API**（把打卡座標反查成地址，顯示在行程明細；不啟用則只顯客戶名+座標）。
   - 憑證 → 建立 **API 金鑰**（建議加 API 限制：只允許 Routes API + Geocoding API）。
2. aiproot 登入戰情室 → 側欄 **AIPROOT 管理 → 地圖里程設定**。
3. **里程計算 provider** 選 **Google Routes** → API Key 貼上金鑰 → **儲存 provider**。
   - key 會**加密存 DB**，只顯示「已設定」不回明碼。
   - 之後每次「到點打卡」自動算前一點→此點的**真實道路里程**並畫在「我的行程」地圖上。

> 替代方案：不想綁卡可改 **OpenRouteService**（openrouteservice.org 免費申請、免綁卡、約 2000 次/天）——同樣回真實道路路線，provider 選 OpenRouteService 貼 token 即可。
> 沒設 key 也能打卡，`distance_m` 先記空白（顯示「里程計算中」）、設好 key 後的新打卡才會算。
>
> 註：**地圖底圖**（CARTO light）不需金鑰，與此里程 key 無關；上面設的是「算公里數」用的 key。

---

## Part B · 建立圖文選單（Rich Menu）

到 **manager.line.biz** → 選官方帳號（AI-TWBRAUN）→ 左側 **聊天室相關 → 圖文選單** → **建立**。

### B1 · 基本設定
| 欄位 | 填法 |
|---|---|
| 標題 | 內部用，例：外勤功能選單 |
| 使用期間 | 起訖日期（可設很長） |
| 選單列文字 | 底部展開列的字，例：功能 |
| 預設顯示 | 開啟（聊天一進來就展開） |

### B2 · 選版型 + 背景圖
1. **選版型**：三顆按鈕挑「**1 列 3 欄**」版面（大版或半高版皆可）。
2. **上傳背景圖**：圖文選單是「**一張背景圖 + 在上面框可點區塊**」，所以背景圖上要**畫好按鈕文字**（打卡／我的行程／我的日報）。
   - 現成 mockup 背景圖（三欄）：`docs/mockup/richmenu/richmenu-large-2500x1686.png`（大版）、`richmenu-compact-2500x843.png`（半高版），直接上傳即可。
   - LINE 也有內建版型可直接套色塊。

### B3 · 設每個區塊的動作（**關鍵**）
點每一個按鈕區塊 → **動作類型選「連結」（URI）** → 貼對應網址：

| 按鈕（左→右） | 動作＝連結，網址貼 |
|---|---|
| **打卡** | `https://liff.line.me/2010801742-WBQkAv5t?page=punch` |
| **我的行程** | `https://liff.line.me/2010801742-WBQkAv5t?page=trips` |
| **我的日報** | `https://liff.line.me/2010801742-WBQkAv5t?page=mine` |

> ⚠️ 一定要選「連結／URI」並貼 `liff.line.me/...`，選單才會在 LINE 內開 LIFF 頁。不要選「文字」或「優惠券」。
> ⚠️ 三個區塊的網址只差結尾 `?page=`（punch / trips / mine），別貼錯。

### B4 · 儲存並設為顯示中
儲存 → 確認狀態為「**顯示中 / 使用中**」。

---

## Part C · 驗證（用手機實測）

前提：測試帳號是**已綁定**的員工（未綁定會被導去綁定）。

1. 打開與官方帳號的聊天 → 底部圖文選單出現。
2. 點 **打卡** → 開啟打卡頁 → 允許定位權限 → 點「**出發打卡**」→ 應顯示「已出發打卡」。
3. 移動到別處（或稍後）→ 點「**到點打卡**」→ 應顯示「已到點打卡 · 本段 X.X km」（若地圖 key 已設）。
4. 頁面下方「今日移動紀錄」出現逐段里程 + 合計。
5. 點 **我的行程** → 開啟行程頁 → 預設今天 → 地圖畫出逐段路線 + 打卡圖釘、下方打卡時間軸與逐段里程（點某段可展開看出發/到點地址、道路 vs 直線距離、算法）；可選日期查其他天。
6. 點 **我的日報** → 應開啟可編輯的日報頁。

---

## 常見問題

| 症狀 | 原因 / 解法 |
|---|---|
| 點按鈕沒反應 / 開錯頁 | 動作沒選「連結」或網址貼錯；`?page=` 拼錯（punch / mine） |
| 開了頁但「缺 botId」 | 只有綁定/設密碼頁需要 botId；打卡/日報走 JWT 不需 botId。若仍出錯多為 LINE webview 快取舊版 → 完全關閉重開 |
| 打卡成功但里程空白 | 地圖 key 未設（Part A）· 或 provider API 暫時失敗（會記 null，不影響打卡） |
| 定位一直失敗 / 逾時 | iOS 有時需重試（到空曠處）；確認手機定位服務、LINE 定位權限已開 |
| 顯示「尚未完成綁定」 | 該帳號還沒綁 → 先私訊 bot 點「開始綁定」 |

---

## 附錄 · 相關

- LIFF 三視圖收斂：`docs/modules/liff-webapp-consolidation.md`
- 定位里程設計：`docs/modules/attendance-location-mileage.md`
- LIFF 建立/配置：`docs/sop/liff-setup.md`
