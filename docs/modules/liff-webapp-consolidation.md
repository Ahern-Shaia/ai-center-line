# 設計文件 · LIFF 網頁動態化與收斂（M0）

> 狀態：**M0 · 開放問題待用戶裁定**（依 CLAUDE.md R6）
> 對象：`web/public/liff/binding.html`（LIFF 靜態頁）、`web/src/personal-report/MyDailyReport.tsx`（web SPA）、`server/src/personal-daily-report/*`。
> 日期：2026-07-24 · 作者：ahern + Claude

---

## 1. 背景與問題（用戶回報：LIFF 網頁數據不同步、無法直接編輯草稿）

「我的日報」目前有**兩套各自維護的實作**：

| | LIFF（LINE 內） | 戰情室 web |
|---|---|---|
| 前端 | `web/public/liff/binding.html`（**靜態 HTML + vanilla JS · 772 行**，含 binding / set-password / mine 三視圖）| `MyDailyReport.tsx`（React · 完整編輯/刪除/存草稿/送出）|
| 後端 | `/personal-daily-report/liff/{mine,save,regenerate}`（`@Public`）| `/personal-daily-report/{mine,mine/save,mine/regenerate}`（JWT）|
| 認證 | **botId + lineUserId（前端送、後端信任）** | JWT（email/密碼 or LINE Login 換發）|

`binding.html` 的 mine 視圖其實**已用 vanilla JS 重寫了一份編輯器**（`renderMineItem` 編輯模式、`mineSaveEdit`、加項、存草稿、送出、live preview）——等於把 `MyDailyReport.tsx` 抄了一份。

### 病灶（為何「不同步 / 無法編輯」）
1. **平行雙實作發散** —— 同一功能兩份程式碼（React vs vanilla JS）。任何修正/新欄位要改兩處，久了行為與資料呈現不一致 → 用戶感受到的「數據不同步」、「LIFF 版編輯不如 web 版」。
2. **靜態頁 webview 快取** —— `binding.html` 是靜態檔，LINE 內建瀏覽器易快取舊版（本 repo 已為 SPA 做版本偵測橫幅 `UpdateBanner`，但**靜態 LIFF 頁吃不到**）→ 另一半「不同步」。
3. **🔒 安全缺口（IDOR）** —— LIFF 端點 `@Public` 且**信任前端送來的 `lineUserId`**（controller L43「用 botId + lineUserId 認證（LIFF SDK 保證）」）。實際上 lineUserId 是前端可竄改的參數 → 帶別人的 lineUserId 即可讀/改/送**他人**日報。這正是 LINE 官方明文警告的反模式（「別從前端送 userId 到後端」）。

---

## 2. LIFF 技術限制（查證文檔，影響方案）

- **`liff.init()` scope**：只保證在「與 endpoint URL 完全相同或**更深路徑**」的 URL 運作；SPA client-side route 若跳出 endpoint scope，liff.init 行為不保證（v2.27.2+ 會警告）。→ SPA 跑進 LIFF 應用 **HashRouter**（hash 變動不改 base path），或把 LIFF endpoint 設在 base 路徑。
- **安全識別**：應送 **`liff.getIDToken()`（ID token, JWT）或 `liff.getAccessToken()`** 到後端**驗證**（access token 走 `GET /oauth2/v2.1/verify` + `/v2/profile`；ID token 驗簽 + `/oauth2/v2.1/verify`），再由後端拿到可信 userId。**不可**直接信任前端送的 profile/userId。
- 本 repo **已有** LINE Login OAuth（`/auth/line/callback`，earlier 修過）能把 LINE 身分換成 JWT —— 可作為「LIFF token → 驗證 → JWT」的現成骨架。

---

## 3. 方案評估

### 方案 A · 只修補靜態頁（status quo+）
維持 `binding.html`，逐一修 sync/編輯 bug。
- ✅ 成本最低、不動認證。
- ❌ 雙實作發散**不解**、安全缺口**仍在**、每次日報功能改動要做兩遍、快取問題續存。**不建議**（治標）。

### 方案 B · LIFF 內跑 React SPA（單一實作，全收斂）
LIFF endpoint 指向 Vite SPA 的 `/liff` route（HashRouter）：`liff.init()` → 取 ID/access token → 後端**驗證**換發 JWT（複用 LINE OAuth 骨架）→ 渲染**同一份 `MyDailyReport.tsx`**（走 JWT `mine*` 端點）。
- ✅ 單一程式碼、永遠同步、完整編輯、**統一且已驗證的認證（修掉 IDOR）**、繼承版本偵測橫幅與快取處理、與 web 版行為一致。
- ❌ 初期工較大；bundle（LIFF 載整個 SPA → 用獨立 lean entry / code-split 緩解）；LIFF 路由要小心（HashRouter）；需新增「token 驗證 → JWT」端點。

### 方案 C · 混合（務實首步，收斂最大痛點）
`binding.html` 保留 **binding + set-password**（簡單、綁定前、少變動）；只把**「我的日報」編輯器**移進 React SPA route（複雜、常變、正是發散來源）。
- ✅ 用比 B 小的範圍**幹掉最大一塊發散**（編輯器）；綁定頁維持精簡。
- ❌ 過渡期兩種 context / 兩種認證並存。

**初步傾向**：**C 作為第一步 → 逐步收斂到 B**，並**優先修認證**（token 驗證換 JWT，一併補 IDOR）。但方向由你裁定（見 §6 OQ）。

---

## 4. 遷移計畫（R1 · 破壞性變更需分段、可回退）
1. **M1 認證骨架**：新增 `POST /auth/liff/token`（收 access/ID token → 驗證 → 對照 binding → 發 JWT）。舊 `liff/*` 端點暫留（過渡）。
2. **M2 SPA LIFF entry**：Vite 加 `/liff` route（HashRouter）· liff.init → 換 JWT → 掛 `MyDailyReport`。
3. **M3 切換**：bot「開始綁定 / 我的日報」按鈕 URL 指向新 route；舊 binding.html 保留一版做 fallback。
4. **M4 收斂**：確認穩定後，`liff/*` 舊端點與 binding.html 重複邏輯下架（或依方案 C 保留 binding 視圖）。

## 5. 失效場景反思（FMEA · 上線前補全，R17）
- 認證遷移期間**既有已綁員工不可斷**（新舊端點並存、灰度）。
- **LIFF init scope**：route 跳出 scope → liff 失效（HashRouter 緩解；需實測 LINE 內 + 外部瀏覽器兩情境）。
- **token 驗證延遲/失敗**：LINE verify API 逾時 → 需 loading/error 三態、可重試。
- **低階手機效能 / bundle**：SPA 進 LIFF 首載成本 → lean entry + code-split，實測。
- **快取**：LIFF 頁需正確 cache header + 繼承 UpdateBanner。

---

## 6. 開放問題（OQ · 待你裁定，才進 M1）

- **OQ-LIFF-1 範圍**：走**方案 C**（只把「我的日報」移進 SPA、binding 頁維持靜態）還是**方案 B**（binding 也收進 SPA）？
- **OQ-LIFF-2 認證**：是否採 **LIFF token 驗證 → JWT**（一併修 IDOR）？用 **ID token** 還是 **access token** 驗證？（建議 access token + `verify` + `/v2/profile`，或 ID token 驗簽）
- **OQ-LIFF-3 路由**：LIFF SPA 用 **HashRouter**（推薦，最省事符合 liff.init scope），還是把 endpoint 設 base 路徑走 BrowserRouter？
- **OQ-LIFF-4 打包**：可接受 LIFF 載入完整戰情室 SPA（code-split），還是要**獨立 lean LIFF entry**（只含日報/綁定，較小首載）？
- **OQ-LIFF-5 情境**：LIFF 是否**必須同時支援外部瀏覽器**（非 LINE 內）？影響路由與 login redirect 設計。
- **OQ-LIFF-6 安全時程**：IDOR（信任 lineUserId）要**這次一起修**，還是先獨立 hotfix（不論本收斂方向）？

---

## 附錄 · 來源
- [Developing a LIFF app · liff.init scope](https://developers.line.biz/en/docs/liff/developing-liff-apps/)
- [Using user data in LIFF apps and servers（送 token、後端驗證）](https://developers.line.biz/en/docs/liff/using-user-profile/)
- [Verify ID token](https://developers.line.biz/en/docs/line-login/verify-id-token/)
- [Managing access tokens（verify）](https://developers.line.biz/en/docs/line-login/managing-access-tokens/)
- LINE Developers TH：別從前端送 User ID 到後端（反模式警示）
