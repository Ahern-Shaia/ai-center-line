# LIFF 綁定 · 建立 · 配置 · 驗證 SOP

> 從 0 開始把「員工 60 秒 LINE 內完成綁定」flow 串起來的完整步驟。適用 aiproot 新租戶開通、或首次 LIFF 建置。
>
> 版本：v1.0（2026-07-23）
> 對應模組：`docs/modules/employee-line-binding.md` 方向 8 · LIFF Zero-Config
> 相關 SOP：[LINE Messaging API 串接 SOP](./line-messaging-api-setup.md)（本 SOP 前置條件）

---

## 0. 什麼時候用這份 SOP

- **首次建置**：aiproot 帳號從零建立第一個 LIFF app（一次性）
- **新租戶接入**：租戶用共用 LIFF · 但確認 Linked bot / channel 狀態
- **除錯**：LIFF 開啟顯示錯誤 · 對照 §7 troubleshooting

---

## 1. 前置條件

| 項目 | 說明 |
|---|---|
| Messaging API channel 已建 | 對應 [LINE Messaging API 串接 SOP](./line-messaging-api-setup.md) §3-§4 完成 · bot 可推群組訊息 |
| Backend 已部署 · webhook 已 connect | 加好友 → follow event 能收到 |
| Web static site 部署可用 | `binding.html` 可從 `<web-url>/liff/binding.html` 存取 |
| DB migration 0016 已跑 | `user_line_binding` 表存在 |
| LINE Business ID 有 admin 權限 | 可管 aiproot Provider 底下所有 channel |

---

## 2. 架構認識（動手前先看）

### 2.1 為什麼要開 LINE Login channel · 不是直接掛 Messaging API

LINE 2025 起改架構：**LIFF app 不能加在 Messaging API channel 底下** · 必須開一個 **LINE Login channel** 掛。

若在 Messaging API channel 找 LIFF tab · 會顯示：
```
You can no longer add LIFF apps to a Messaging API channel.
Use a LINE Login channel instead.
```

### 2.2 UserId 一致性 · 靠 Provider 隔離

- 同一 Provider 底下 · 所有 channel（Login + Messaging API）看到的 LINE UserId **一致**
- 這是 LIFF 拿到的 `liff.getProfile().userId` 能對到 webhook `event.source.userId` 的技術命脈
- **必然條件**：LINE Login channel 跟 Messaging API bot **同 Provider**

### 2.3 一個 LIFF app 服務所有租戶

- aiproot 只需**一個 LINE Login channel + 一個 LIFF app**（不需要 per-tenant）
- 靠 `?botId=<uuid>` query param 路由到正確 tenant
- 未來若 tenant 有客製化需求（e.g. 品牌 UI）· 才考慮 per-tenant LIFF

---

## 3. 建 LINE Login channel

1. 登入 [LINE Developers Console](https://developers.line.biz/console/)
2. 選 **aiproot Provider**（管台灣福祉 bot 那個）
3. 點頂部「**Create a new channel**」
4. 選 **LINE Login**
5. 填：
   - **Channel name**：`aiproot 綁定`（顯示用 · 藍領員工不會看到）
   - **Channel description**：隨意 · e.g.「員工 LINE 與 aiproot 帳號綁定」
   - **App types**：勾 **Web app**
   - **Region**：Taiwan
   - **Privacy Policy URL**：aiproot 官網 privacy 頁（LINE 強制）
   - **Terms of Use URL**：aiproot 官網 terms 頁
6. Create · 拿到 channel

---

## 4. Link 到 Messaging API bot（**關鍵** · 別跳過）

**若不做這步**：LIFF SDK 拿到的 UserId 跟 webhook 收到的**不一致** · 綁定 flow 走完但反查對不到人 · 假成功。

實務上 · 同 Provider 底下 UserId 是共享的 · 但這欄位是 LINE 平台級 metadata · Linked 才能：
- LIFF UI 顯示對應 bot 資訊
- 若使用者未加 bot 好友 · LIFF 內能自動提示加

### 步驟

1. 進剛建的 **LINE Login channel** 設定
2. **Basic settings** 分頁
3. 找 **Linked LINE Official Account** 欄位
4. 點 **Edit** · 從下拉選你的 Messaging API bot（同 Provider 底下才會出現）
5. 儲存 · 應顯 「✓ Linked · <bot 名>」

### 驗證方式

Linked 成功後：Alice 用 LINE 帳號 A 加 bot 好友 → 開 LIFF → `liff.getProfile().userId` 拿到的 UserId · 應**等於** webhook 收 follow event 的 `event.source.userId`。

---

## 5. 加 LIFF app

1. LINE Login channel → **LIFF** 分頁
2. 點 **Add**
3. 填：

| 欄位 | 值 | 說明 |
|---|---|---|
| **LIFF app name** | `binding` | 內部識別用 |
| **Size** | **Full** | 滿版 · 藍領大字體友善 |
| **Endpoint URL** | `https://<web-static-url>/liff/binding.html` | 你的 web static 位置 · e.g. `https://ai-center-line-demo.onrender.com/liff/binding.html` |
| **Scopes** | ✓ **profile** | 拿 UserId / displayName / pictureUrl · openid / chat_message.write 不用勾 |
| **Add friend option** | **On (normal)** | 若使用者未加 bot 好友 · LIFF 內提示加。Aggressive 太強迫 · Off 錯過提示機會 |
| **Scan QR** | 不勾 | 不用 |

4. Add · 拿到 **LIFF ID**（形如 `2010801742-WBQkAv5t`）· 記下來

---

## 6. Publish channel（否則其他用戶進不去）

新建 LINE Login channel **預設在 Developing 狀態** · 只有 admin/developer 能用 · 其他人進 LIFF 會遇：
```
400 Bad Request
This channel is now developing status. User need to have developer role.
```

### 6.1 兩個選擇

| 選項 | 適用場景 | 動作 |
|---|---|---|
| **Publish**（推薦） | 正式給客戶員工用 | Basic settings → Channel status → 切 **Published** |
| Developer role | 自測 · 少數內部人試 | Roles 分頁 → Add → 輸入測試員工 LINE email · 角色 Developer |

### 6.2 Publish 注意

- **不可回滾**（一旦 Published 不能再回 Developing · 但可 Disable channel）
- Publish 前建議至少走過一次自測（用 Developer role）

---

## 7. 更新 backend 與 frontend 配置

### 7.1 Backend · Render env

Render dashboard → backend service (`ai-center-line`) → **Environment**：

```
LIFF_URL=https://liff.line.me/<你的 LIFF ID>
```

例：`LIFF_URL=https://liff.line.me/2010801742-WBQkAv5t`

**為什麼用 `liff.line.me` 短網址不用你的 endpoint URL**：
- `liff.line.me/<id>` 是 LINE 官方 dispatcher · 在 LINE App 內開啟時**保持在 App 內**
- 若直接用 endpoint URL · 會跳出瀏覽器 · 破壞 LIFF Zero-Config 體驗

儲存 → 觸發 backend redeploy。

### 7.2 Frontend · 注入 LIFF ID 到 binding.html

編輯 `web/public/liff/binding.html`：

```html
<script>
  const LIFF_ID = "2010801742-WBQkAv5t";   // 更新這裡
  // ...
</script>
```

Commit + push · 觸發 web static site redeploy。

**未來若切 per-tenant LIFF**：改成 build-time env 注入 · 或 backend server-render binding.html。

---

## 8. 端到端驗證

### 8.1 前置確認 checklist

- [ ] LINE Login channel 已建 · Linked LINE Official Account 綁對 bot
- [ ] LIFF app 已 Add · LIFF ID 記錄
- [ ] Channel 已 Publish（或測試員工加為 Developer role）
- [ ] Render env `LIFF_URL` 已設 · backend 已 redeploy
- [ ] `binding.html` 已注入 LIFF ID · web 已 redeploy
- [ ] DB migration 0016 已跑 · `user_line_binding` 表存在

### 8.2 端到端測試步驟

**用「還沒加過該 bot」的 LINE 帳號**（或先移除好友 · 重加）：

1. **加 bot 好友**
   - 打開 LINE App → 搜尋 bot（用 Basic ID `@xxx`）→ 加好友

2. **確認 bot 自動推綁定訊息**
   - 應立即收到：
     ```
     歡迎加入！請點下方按鈕完成綁定 · 綁定後即可使用個人日報功能
     [ 開始綁定 ]
     ```
   - 若沒收到 → 對照 §9 troubleshooting「follow event 沒觸發」

3. **點「開始綁定」按鈕**
   - LIFF 在 LINE App 內開啟 binding.html
   - 顯示：載入中 → pre-fill 確認頁

4. **確認 pre-fill 資料**
   - displayName 是 Alice 的 LINE 名
   - 若 Alice 過去在群組發過訊息 · 顯示候選群組 · 可調整
   - 若沒發過訊息 · 顯示空 · Alice 手動選部門

5. **送出**
   - 應顯「✓ 綁定成功」
   - 點右上關閉 · 回 LINE 聊天視窗

6. **私訊 bot 測 personal message flow**
   - Alice 傳「hi」給 bot
   - Bot 回：「✓ 已記錄」
   - 若回「請先完成綁定」→ 綁定沒成功 · 對照 §9

7. **後台驗證**
   - Aiproot 後台 → LINE 綁定 audit
   - 應看到新一筆 · 員工 = Alice · Method = `liff_self_service`

### 8.3 Backend log 檢查

Render backend logs 應有：
```
[line-webhook] follow · pushed LIFF · botId=<uuid> · userId=<xxx>
LIFF binding complete · user=Alice (uuid) · botId=... · lineUserId=xxx
```

---

## 9. Troubleshooting

### 9.1 LIFF 開啟顯「400 · developer role」

**原因**：Channel 在 Developing 狀態 · 該 LINE 帳號不是 developer

**修**：
- 正式用 · §6 Publish channel
- 測試用 · Roles 加該帳號為 Developer

### 9.2 LIFF 開啟顯「缺 botId 參數」

**原因**：使用者直接開 LIFF 網址 · 沒經過「加好友→收 bot 按鈕→點按鈕」正常 flow

**判斷**：
- 若使用者可以走正常 flow · 這是設計行為 · 擋掉直接訪問
- 若你自己測 · 手動組帶 botId 的 URL：`https://liff.line.me/<liff-id>?botId=<bot-uuid>`

### 9.3 加好友後 bot 沒推綁定訊息

**檢查順序**：

1. **Render env `LIFF_URL` 是否設**
   - 未設 · code 判斷後直接 return · 不推
   - 修：加 env → redeploy

2. **Backend webhook 是否有收 follow event**
   - Render logs 搜 `[line-webhook] follow`
   - 沒 log · 表示 webhook 沒 connect · 對照 [LINE Messaging API SOP](./line-messaging-api-setup.md) §7 檢查 webhook URL 設定

3. **Reply message API 是否失敗**
   - Render logs 搜 `follow reply 失敗`
   - 常見原因：`channelAccessToken` 過期 or 錯

### 9.4 綁定成功但私訊 bot 回「請先完成綁定」

**原因**：LIFF 拿到的 UserId ≠ webhook 收到的 UserId · 反查不到 binding

**檢查**：
- **LINE Login channel 是否 Linked 到 Messaging API bot**（§4）
- **兩 channel 是否同 Provider**（§2.2）
- 若都做對還是壞 · Render logs 印出兩邊 UserId 對比

### 9.5 LIFF UI 顯「未綁定」但你確定綁過

**原因**：`user_line_binding` 表 `status='revoked'` · 或 aiproot audit 撤銷過

**修**：
- Aiproot 後台 → LINE 綁定 audit → 找該 binding → status 檢查
- 若 revoked · Alice 重走 LIFF flow 就會建新 active binding

### 9.6 LIFF 一直「載入中」不動

**檢查**：
- 瀏覽器 devtools console log · 看 LIFF SDK error
- 常見：`liff.init()` failed · 因 LIFF ID 錯（`binding.html` 沒注入正確）
- 常見：`/binding/liff/prefill` 500 error · 對應 backend 問題

### 9.7 端到端流程走完但 aiproot audit 沒看到

**檢查**：
- 是不是選錯 tenant · audit 頁上方切租戶
- Backend logs 找 `LIFF binding complete` · 有 = 綁定成功 · 只是 UI 沒 refresh · 點重新整理

---

## 10. 新租戶接入 · 只需做的步驟

若共用同一個 LIFF app（推薦 · §2.3）· 新租戶接入只需：

1. 依 [LINE Messaging API SOP](./line-messaging-api-setup.md) 建 Messaging API channel + bot
2. **確認新 bot 跟 LIFF app 在同一個 Provider**（否則 UserId 不同）
3. 在 aiproot 後台 → 通訊接頭層 → LINE 機器人 → 新增該 bot（拿到 bot UUID）
4. 不用重建 LIFF · 不用改 LIFF ID · 不用改 backend env

**新租戶員工綁定 flow 立即可用**。

### 10.1 若新租戶要**獨立** LIFF（品牌客製）

回 §3 開新 LINE Login channel（但同 Provider）· §5 加新 LIFF app · 拿新 LIFF ID · backend 需改成 per-tenant `LIFF_URL` map。

**這是 Phase 2+ 才考慮的擴展 · MVP 不做**。

---

## 附錄：本 SOP 變更記錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-23 | v1.0 | 首版 · 從實作 employee-line-binding 方向 8 提煉 | ahern + Claude |
