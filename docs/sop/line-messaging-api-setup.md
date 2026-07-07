# LINE Messaging API 串接 SOP

> 從 0 開始把「後端服務推播 LINE 群組訊息」串起來的完整步驟。專案無關 — 換其他專案照抄即可。
>
> 版本：v1.0（2026-07-07）
> 適用情境：後端主動 push 訊息到既有 LINE 群組（不含被動 reply / rich menu / Flex）
> 若你要做的是 **被動 reply**（使用者發訊 → bot 回覆）：webhook 設定改為指向你的服務，並用 `reply token`（免費、不吃 push quota），本 SOP 的 webhook 章節只講「一次性抓 groupId」用途

---

## 0. 為什麼不用 Ragic / Notion / Slack 內建「傳 LINE 通知」？

那類內建功能通常是 **個人 1:1 綁定**（每個 user 綁自己 LINE ID → 通知只到自己）。**沒辦法主動推到既有群組**（例：業務群、值班群）。

要推群組必須：
1. 有一個 LINE **官方帳號**（Official Account）
2. 該帳號**加入群組成為成員**
3. 用該帳號的 **Messaging API** 呼叫 `POST /v2/bot/message/push` 帶 `groupId`

本 SOP 就是走這條路。

---

## 1. 事前準備

| 項目 | 說明 | 費用 |
|---|---|---|
| LINE 商用帳號（LINE Business ID）| 用來登入 Developers Console；與個人 LINE 分開 | 免費 |
| LINE Official Account | 「一個對外發訊的品牌帳號」，可加入群組 / 加好友 | 免費 tier 有 |
| Messaging API Channel | 綁在 Official Account 上，開 API 存取用 | 免費 |
| 一個 LINE 群組 | 目標推播對象；官方帳號必須是群組成員才能推 | — |
| 一次性 webhook 接收工具 | 抓 `groupId` 用；本 SOP 用 https://webhook.site | 免費 |
| `curl`（或 Postman）| 做 API 驗證用 | — |

---

## 2. 建 LINE Official Account（若已有可跳過）

1. 進 <https://www.linebiz.com/tw/entry/> 或 LINE Official Account Manager <https://manager.line.biz/>
2. 用 LINE Business ID 登入 → 「建立 LINE 官方帳號」
3. 填帳號名稱（例：「台灣福祉 AI客服」）、類別、國家
4. 完成後拿到一個 **Provider**（發行者）+ **Official Account**（官方帳號）
5. 記住這個帳號的 **Basic ID**（`@xxx` 開頭）— 之後要用這個 ID 加入群組

---

## 3. 開 Messaging API Channel

1. 進 LINE Developers Console <https://developers.line.biz/console/>
2. 選你的 Provider → 「Create a Messaging API channel」
3. 綁到剛才那個 Official Account（下拉選單）
4. 填 Channel name / description / category / subcategory → Create
5. 進入該 Channel 的頁面

---

## 4. 取「Channel access token（long-lived）」— 給後端用

**⚠️ 三種 token 一定要分清楚，用錯全掛：**

| 名稱 | 長什麼樣 | 用途 |
|---|---|---|
| Channel ID | 純數字，例 `1234567890` | 只是識別碼，**不用貼進 backend** |
| Channel secret | 32 字元十六進位 | 驗 LINE → 你 webhook 的簽章。**除非你做被動 reply / webhook 才需要** |
| **Channel access token (long-lived)** | 170 左右字元 JWT 樣式 | **後端呼叫 LINE API 的 Bearer token — 就是這個** |

### 4.1 取 token 步驟

1. Developers Console → 你的 Channel → 上方 tab **「Messaging API」**
2. 頁面往下捲到 **「Channel access token」** 區塊
3. 選 **「Channel access token (long-lived)」**（v1，永久有效，最簡單）
   - 另一個「Stateless Channel access token」(v2.1) 是 15 分鐘期，需 refresh 邏輯，除非有特殊需求（多環境 rotation）否則不建議
4. 按 **「Issue」** → 產出一長串（150-200 字元）
5. **立刻**複製起來貼進後端 env

### 4.2 貼進 env（範例）

```env
# .env
LINE_CHANNEL_ACCESS_TOKEN=4X4TWXiRaF0K...（一長串）
```

**安全注意**：
- Token 一旦洩漏，任何人都能用你的官方帳號名義發訊；務必只放 backend env（不要進前端、不要進 git、不要 log 出來）
- 定期輪替：Developers Console 內可再 `Issue` 新 token，舊 token **同時失效**（不像 v2.1 可並存），所以輪替時需 zero-downtime 換 env
- 若懷疑洩漏，立刻回 Console 重按 Issue 讓舊 token 作廢

---

## 5. 取「群組 groupId」— 一次性抓，長期沿用

**LINE App UI 看不到 groupId**（無論手機 or 電腦版），必須透過 webhook 抓一次。

### 5.1 開臨時 webhook 接收站

1. 進 <https://webhook.site>（免登入）
2. 頁面自動配一組 unique URL：`https://webhook.site/{某段 UUID}`
3. 保留此頁不關；任何進來的 HTTP 請求會即時顯示

（其他選項：ngrok、Cloudflare Tunnel、beeceptor、requestbin — 選一個順手的即可。webhook.site 最零門檻。）

### 5.2 把 webhook URL 掛到 Channel

1. 回 LINE Developers Console → 你的 Channel → **Messaging API** tab
2. 找到 **「Webhook settings」** 區塊
3. **Webhook URL**：貼 webhook.site 的 URL
4. 按旁邊 **「Verify」** → 應顯示 Success（LINE 打得到 webhook.site）
5. 開啟 **「Use webhook」** toggle

### 5.3 讓官方帳號進群組

1. LINE App 開你要抓 ID 的群組
2. 點群組右上「＋」→ 邀請 → 輸入官方帳號的 **Basic ID**（`@xxx`）→ 邀請進來
3. 若加不進去：檢查 Console → 你的 Channel → 「Messaging API」→ 開 **「Allow bot to join group chats」**（或 LINE Official Account Manager 內設定）

### 5.4 在群組發任意訊息 → 抓 groupId

1. 群組裡任意成員發一則訊息（例：「id?」）
2. 回 webhook.site 頁面 → 應該立刻看到一筆 POST 進來
3. 展開 body JSON，找 `events[0].source.groupId`：

```json
{
  "destination": "U...",
  "events": [
    {
      "type": "message",
      "message": { "type": "text", "text": "id?" },
      "source": {
        "type": "group",
        "groupId": "C1234567890abcdef1234567890abcdef",   ← 這個
        "userId": "U..."
      },
      "replyToken": "..."
    }
  ]
}
```

- `groupId` 一定 **`C` 開頭 + 33 位**（含 `C`）
- **1:1 聊天** 是 `source.type = "user"`（沒有 groupId）
- **多人聊天室**（非正式群組）是 `source.type = "room"` + `roomId`

### 5.5 貼進 env + 關掉臨時 webhook

```env
LINE_GROUP_ID_BUSINESS_ASSIST=C1234567890abcdef1234567890abcdef
```

**關掉 webhook.site**（重要 — 否則群組後續每則訊息都會被 webhook.site 收到，隱私/濫用風險）：
- 回 Console → Webhook settings → **關 「Use webhook」toggle**
- 或改成你正式 backend 的 webhook URL（若之後你要做被動 reply）

---

## 6. curl 驗證（送一則測試訊息）

```bash
# 從 env 讀
TOKEN=$(grep '^LINE_CHANNEL_ACCESS_TOKEN=' .env | cut -d= -f2-)
GROUP=$(grep '^LINE_GROUP_ID_BUSINESS_ASSIST=' .env | cut -d= -f2-)

curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "to": "'"$GROUP"'",
    "messages": [{"type":"text","text":"【SOP 測試】收到請忽略"}]
  }' \
  https://api.line.me/v2/bot/message/push
```

**成功**（HTTP 200）response：
```json
{"sentMessages":[{"id":"621760151171105042","quoteToken":"..."}]}
```

**常見失敗**：

| HTTP | body | 意思 | 修 |
|---|---|---|---|
| 401 | `{"message":"Authentication failed"}` | Token 錯 / 過期 / 或漏 `Bearer ` 前綴 | 回 Console 重新 Issue 或檢查 header 格式 |
| 403 | `{"message":"You have not been given ..."}` | 官方帳號沒被 push message 權限 | Console → Messaging API → 檢查「Response settings」開了 push |
| 400 | `{"message":"The group ID is invalid"}` | groupId 打錯 or 該帳號沒在群裡 | 回 §5 重抓 groupId + 確認帳號還在群裡 |
| 429 | `{"message":"You have reached your monthly limit"}` | 超月配額 | 見 §8 用量方案 |

---

## 7. 訊息型別 — Phase 1 建議只用純文字

Push 支援的 `messages[i].type`：

| type | 用途 | 建議 |
|---|---|---|
| `text` | 純文字（含 emoji、`\n` 換行） | ✅ **首推**，最穩、可讀性最好、debug 最容易 |
| `sticker` | 官方貼圖 | 通知類幾乎用不到 |
| `image` / `video` / `audio` | 媒體訊息 | 需 host 檔案 URL；不建議自建 |
| `location` | 位置 | 適合叫車 / 地圖類 |
| `template` | 按鈕、輪播、確認 | 廢棄前身，改用 Flex |
| **`flex`** | 富媒體卡片（HTML 樣結構）| 複雜度高、除錯難；有明確 UI 需求再上 |
| `imagemap` | 可點擊圖片 | 罕見 |

**單則 push 上限 5 events × 每 event 5000 字元**（純文字）。實務保守限 200 字/行、8 行以內。

---

## 8. 用量方案（2026 年費率）

| 方案 | 月固定費 | 免費訊息 | 超額每則 |
|---|---|---|---|
| 輕用量 | 免費 | 200 則 | ❌ 不能發送 |
| 中用量 | NT$800 / 月 | 4000 則 | NT$0.2 |
| 大用量 | NT$1600 / 月 | 25000 則 | NT$0.15 |

**「1 則」怎麼算**：每個 API 呼叫 × 該呼叫送出的 event 數 × 該呼叫的訊息收件人數。同一個 push 打到 1 個 group = 1 則。broadcast 打 1000 好友 = 1000 則。

**注意**：早期免費 tier 是 500 則，2024 起降到 200 則。做開發階段量小沒問題；上線量起來要 alert 監控。

實作端建議：
- 收到 429 一律**不 retry**（重發只會加深 quota）
- 設 dashboard alert：本月已用 >= 160 則（80% 觸發）→ 通知升方案
- 詳細查詢：Official Account Manager → 統計 → 訊息數

---

## 9. 常見踩坑

| 症狀 | 原因 | 處置 |
|---|---|---|
| 401 Authentication failed | Token 少 `Bearer ` 前綴 / 貼錯 / v2.1 stateless 過期 | 檢查 header；用 long-lived token 避免 |
| 400 The group ID is invalid | groupId 用了 1:1 的 userId | source.type 要是 `group` 才有 groupId；1:1 chat 沒有 |
| 400 The property `to` is required | payload 沒帶 `to` field | 檢查 JSON 結構 |
| 官方帳號加不進群 | Channel 沒開「Allow bot to join group chats」 | 在 Console 或 Official Account Manager 開啟 |
| 收得到訊息但業助沒感覺 | 官方帳號被個人 mute 群組通知 | 群裡點官方帳號 → 開通知 |
| 訊息帶 `\n` 顯示亂 | LINE 對 `\r\n` 有時處理不同 | server 端統一折為 `\n`（見 backend `sanitize()`）|
| 換 token 後 API 全 401 | Long-lived 舊 token 被新 Issue 覆蓋失效 | 換 token 要 zero-downtime：一次拿新 token → deploy → 舊自動作廢 |
| Group 重建後 ID 換了 | LINE 給新群組新 ID | 舊 groupId 對新群無效，重跑 §5 抓新 ID |
| Webhook signature 驗簽失敗（做 reply 才會遇到）| 用了 Channel access token 而非 Channel secret | secret 是 32 字元，token 是 170+ 字元；別搞混 |

---

## 10. 環境變數命名規範（跨專案抄）

建議以下命名：

```env
# 必填
LINE_CHANNEL_ACCESS_TOKEN=              # long-lived token（170 字元 JWT-like）
LINE_GROUP_ID_<SEMANTIC_NAME>=          # 具語意的目標群組 ID（C 開頭 33 位）
                                        # 例：LINE_GROUP_ID_BUSINESS_ASSIST
                                        #     LINE_GROUP_ID_ONCALL
                                        #     LINE_GROUP_ID_ANNOUNCEMENT

# 選填（做被動 reply / webhook 才需要）
LINE_CHANNEL_SECRET=                    # 32 字元十六進位；驗 webhook 簽章用
LINE_CHANNEL_ID=                        # 純數字；rarely used in code
```

**多群組建議**：一個 backend 打多群，環境變數逐一列（不建議塞逗號串 — 難管理）。多環境（dev / staging / prod）用不同群組 ID 隔離。

---

## 11. 生產環境 checklist

上線前確認：
- [ ] Token 只在 backend env / secret manager，未進 code / log
- [ ] Token 有記錄 rotation 時程（建議 quarterly）
- [ ] 429 不 retry，直接 log
- [ ] 錯誤不擋主流程（LINE 掛不影響上游存檔 / 業務流程）
- [ ] 有 audit log（誰觸發 / 訊息內容 / LINE 回應 / latency）
- [ ] PII retention 有計劃（訊息內容 vs metadata 保留期不同）
- [ ] 用量 alert 已設（80% quota 觸發）
- [ ] Channel access token 一旦 rotate，舊的立刻失效 — 換 env 需要 zero-downtime plan
- [ ] Webhook（若有）驗 `X-Line-Signature` HMAC-SHA256

---

## 12. 參考連結（官方 doc）

- Messaging API 總覽：<https://developers.line.biz/en/docs/messaging-api/>
- Push message API：<https://developers.line.biz/en/reference/messaging-api/#send-push-message>
- Webhook event 結構：<https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects>
- 訊息類型：<https://developers.line.biz/en/reference/messaging-api/#message-objects>
- 用量與費率（台灣）：<https://tw.linebiz.com/service/account-solutions/line-official-account/>
- Rate limits：<https://developers.line.biz/en/docs/messaging-api/rate-limits/>

---

## 附錄：變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-07 | v1.0 | 初版：從 0 建 channel → 取 token → 抓 groupId → curl 驗證 → 踩坑集 | Claude Code |
