# group-id-onboarding · 讓客戶快速取得 LINE 群組 ID

> 狀態：✅ **M0 CLOSED v0.3**（2026-07-31）· 架構＝**aiproot 獨立通用 bot（只回 ID）· 與租戶 bot 分開** · OQ 全數裁定（關鍵字＝`群組ID`、加群直接附 ID）· **M1 可開工**
>
> 相關：[`line-messaging-api-setup`](../sop/line-messaging-api-setup.md)、
> [`notify-selfserve-使用指南`](../sop/notify-selfserve-使用指南.md)（目前要人工填群組 ID 的地方）、
> [`employee-binding-onboarding`](../sop/employee-binding-onboarding.md)
>
> ⚠️ 涉及 webhook 對外回覆訊息（客戶群裡看得到），依 R6 先 design 再實作。

---

## 0. ⭐ 架構裁定（2026-07-31）· 這一版把難題繞過了

用戶決定：**建一支 aiproot（平台）的獨立「通用 bot」，專職回覆群組 ID，與租戶自己的分析 bot 徹底分開。**

| bot | 誰的 | 職責 | 碰租戶資料嗎 |
|---|---|---|---|
| **通用 ID bot**（新）| aiproot 平台 | 加進群 → 回覆該群 ID → 客戶抄走 → 可移除 | ❌ **完全不碰** —— 純工具 |
| **租戶分析 bot**（既有）| 各租戶一支 | 群對話 → 落庫 → AI 分析 → 日誌/任務 | ✅ 租戶隔離 |

**這個切法直接解決了 v0.1 §5 標為「決定性 P0」的租戶歸屬問題** ——
通用 bot 不落庫、不做分析、不需要知道群屬於誰，**所以沒有跨租戶混入的風險**。
它是一支**無狀態的工具 bot**：你問它群 ID，它回你，僅此而已。

流程：客戶把通用 bot 加進群 → 打「群組ID」或看加群歡迎訊息 → 抄下 ID →
（可把通用 bot 移除）→ 再加自己的租戶 bot 做真正的分析。

---

## 1. 問題

**LINE 群組 ID（`Cxxxx…`）在 LINE App 裡看不到** —— 它不是給使用者看的東西，
只能透過 Messaging API 的 webhook 事件（`source.groupId`）取得。

客戶在什麼時候需要它？

| 情境 | 是否真的需要「原始 ID」|
|---|---|
| 連結群組給系統分析 / 分派部門 | ❌ 不需要 —— 系統已**自動註冊 + 自動抓群名**，後台按**名字**選 |
| 設定通知規則（notify 手動填群組 ID）| ✅ 需要原始 ID（目前決定「人工填 ID 最有彈性」）|
| 客戶自己想驗證「這個群是哪一個」| ✅ 想看到 ID |

⭐ **關鍵洞見**：這其實是**兩個不同的需求**，不要用同一個方案硬解：
- **A. 連結群組** → 目標是「**永遠不碰原始 ID**」，按名字選（現況已做到，要強化）
- **B. 真的要拿到原始 ID** → 給一個**最快的自助取得管道**（命令回覆）

---

## 2. 既有現況（查證 2026-07-31）

`line-webhook.service.ts`：

- **群組自動註冊**：bot 收到群裡任何事件 → `upsert line_group`（§146）
- **自動抓群名**：偵測到新群 → `autoProbeGroupName` 抓 display_name（§165）
  → 所以後台「通訊管道 → LINE 群組」列出的是**群名**，客戶不必看 ID
- **關鍵字→回覆機制成熟**：1-on-1 已有「設密碼」「日報」等關鍵字 → `replyMessage`（§405+）
  → 加一個「群組 ID」關鍵字是**零新機制**，建在既有 pattern 上
- **後台已有複製 ID**：通訊管道頁點群名下方灰字即複製完整 ID（notify 手冊 §7 寫過）

**所以缺的不多** —— 主要是「客戶在群裡就能自助拿到 ID」這條最快路徑還沒有。

---

## 3. ⭐ 巨人的肩膀

「LINE bot 怎麼讓人拿到群組 ID」是 LINE 生態的老問題，成熟做法有四種：

### 3.1 命令回覆（最普遍 · 幾乎每個 LINE bot 工具都有）
群裡打一個關鍵字（`群組ID` / `@bot id` / `/id`）→ bot 立刻回覆該群 ID。
- ✅ 最快、自助、不需後台權限、客戶自己就能做
- ⚠️ ID 會顯示在群裡（所有成員看得到）· 但群組 ID **不是機密**，只是雜訊

### 3.2 加入群時歡迎訊息（zero-effort）
bot 被加進群（`join` 事件）→ 自動回一則「已加入 · 本群已登錄 · 若需 ID：Cxxxx」。
- ✅ 零操作，加進去就有
- ⚠️ 同樣在群裡露出 ID

### 3.3 自動註冊 + 後台按名字選（現況 · 最適合「連結群組」）
bot 在群 → 系統登錄 + 抓群名 → 後台按名字選，**客戶完全不碰 ID**。
- ✅ 對「連結群組給部門/分析」是最佳解 —— 原始 ID 根本不該讓客戶處理
- ❌ 對「我就是要那串 ID」（notify 手動填）沒幫助

### 3.4 配對碼（pairing code · 隱藏原始 ID）
bot 在群裡貼一個短碼（如 `AB12`）→ 客戶到後台輸入短碼 → 系統對應到真實群。
- ✅ 客戶不碰醜長的 ID、比較好念
- ❌ 多一個步驟、多一張對應表

### 3.5 一句話
| 借來的 | 用在哪 |
|---|---|
| 命令回覆（3.1）| 需求 B「真的要 ID」的最快自助管道 |
| 加入歡迎（3.2）| 加群當下順手給，降低「不知道去哪拿」|
| 自動註冊+按名字選（3.3）| 需求 A「連結群組」，客戶永遠不碰 ID（現況強化）|
| 配對碼（3.4）| 若要完全隱藏 ID 的進階版（本期不做，複雜度不值）|

---

## 4. 提案設計 · 通用 ID bot

### 4.1 它做什麼（就這三件、其餘一律不做）

| 事件 | bot 行為 |
|---|---|
| **被加進群**（`join`）| 回一則歡迎 + **直接附上本群 ID**（zero-effort，加進去就有）|
| **群裡打關鍵字**（`群組ID` / `#id`）| 回覆本群 ID（on-demand，補加群當下沒抄到的情況）|
| **其他所有事件**（一般聊天訊息、貼圖、成員進出…）| **完全忽略** —— 不落庫、不分析、不回覆 |

加群歡迎訊息（4.1 + on-demand 一次講清楚）：
```
你好，我是 aiproot 的群組 ID 小幫手。
本群組 ID：
Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
（複製上面這串，貼到 aiproot 後台的「LINE 群組」欄位即可）
需要再看一次，在群裡打「群組ID」我就再回你。取得後可將我移除。
```

### 4.2 它明確**不做**什麼（這是它安全的關鍵）

- ❌ 不 `upsert line_group`、不存任何訊息 → **不進任何租戶的分析管線**
- ❌ 不查 `bot_id → tenant_id` → **不需要、也不知道群屬於哪個租戶**
- ❌ 不做媒體下載、成員抓取、日報抽取

→ 因為它什麼租戶資料都不碰，**v0.1 §5 的跨租戶 P0 在這個設計下不存在**。

### 4.3 實作路徑（建在既有 infra 上、但邏輯獨立）

- 通用 bot = **另一個 LINE channel**（獨立 channelAccessToken / channelSecret），
  在 aiproot 平台層註冊（不掛任何 tenant，或掛一個 `platform` 系統租戶）。
- webhook 進來先辨識「這是通用 bot」→ **走獨立的極簡 handler**，
  只做 §4.1 三件事，**完全不進 `line-webhook.service.ts` 的 ingestion 主線**。
  - 建議：專屬路由（如 `POST /webhook/group-id`）或在現有入口用 `bot.kind === "utility"` 早退分流。
- 回覆一律用 `reply token`（免費），不用 push（計費）。
- 關鍵字訊息與一般訊息都**不落庫**（它根本沒有落庫路徑）。

### 4.4 順帶強化需求 A（客戶連結群組時「不碰 ID」）

通用 bot 是給「**真的要那串 ID**」的人（notify 手動填）。至於「連結群組給分析」，
現況租戶 bot 已自動註冊 + 抓群名、後台按名字選 —— 這條不變，只補一個小標記：
- 通訊管道頁對「剛偵測到、還沒分派部門」的群加「**新群 · 待分派**」標記（低優先，可併後續）

---

## 5. v0.1 §5「租戶歸屬 P0」— 已由本架構化解

v0.1 曾把「一支共用 bot 無法判斷群屬於哪個租戶」列為決定性 P0。
**本版的獨立通用 bot 設計直接讓這個問題不存在**：

- 通用 bot 不做歸屬、不落庫，**它從不宣稱任何群屬於任何租戶** → 沒有錯置的可能。
- 真正的租戶歸屬仍走**租戶自己的 bot**（一租戶一支、`bot_id → tenant_id`、RLS 隔離），
  那條路徑不變、既有隔離不動。
- 客戶把通用 bot 取得的 ID 貼進**自己租戶**的後台欄位 → 歸屬由「登入者的租戶」決定，
  不由 bot 決定，天然正確。

---

## 6. FMEA（P0 先列）

| 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|
| 通用 bot 誤把訊息落進某租戶分析 | 跨租戶污染 | **P0** | ✅ 設計上它**沒有落庫路徑**（§4.2）· 實作時獨立 handler、code review 確認不呼叫 ingestion |
| 關鍵字太常見（「id」）誤觸、洗版 | 群裡噪音 | P1 | 🔒 用不易誤觸的關鍵字（`群組ID` / `#群組id`）· 同群 30 秒內重複只回一次 |
| 客戶把 ID 貼錯到別家租戶後台 | 群被錯連 | P1 | ⚠️ 殘留 —— 靠「登入者只能操作自己租戶」限制爆炸半徑；貼上後後台顯示抓到的群名供人眼核對 |
| 通用 bot channel token 外洩 | 別人可冒充它發言 | P2 | ✅ token 走 secret manager（R3）· 它無資料存取權，外洩損害有限 |
| ID 回在群裡被截圖外流 | 低 —— 群 ID 非機密，需配 bot token 才有意義 | P2 | ✅ 可接受 · 文案不顯示任何 tenant 資訊 |

---

## 7. 里程碑

| # | 內容 | 依賴 |
|---|---|---|
| **M0** ✅ | 本文件 · OQ 全數裁定 | — |
| **M1** ✅ | 獨立極簡 handler 已實作（見 §10）· join 直接附 ID + 關鍵字`群組ID`回 ID · 不落庫 · 免費 reply token · 3 支測試守 P0（無落庫路徑）| — |
| **M2** | 客戶手冊：加通用 bot → 取 ID → 貼後台 → 移除 · 通訊管道頁「新群待分派」標記 | M1 |

---

## 8. 開放問題（OQ-GID-N）

| # | 問題 | 為什麼要先問 | 狀態 |
|---|---|---|---|
| ~~OQ-GID-1~~ | 固定 bot 一租戶一支 vs 共用一支？ | 決定性 | ✅ **已答（2026-07-31）**：另建 aiproot 獨立通用 bot 只回 ID、與租戶 bot 分開 → 化解 |
| ~~OQ-GID-2~~ | 用哪個關鍵字？ | 要好記、又不易誤觸 | ✅ **已答（2026-07-31）**：`群組ID`（最白話、小白一看就懂、中文不會誤觸）|
| ~~OQ-GID-3~~ | 加群直接附 ID vs 只在關鍵字才給？ | 零操作 vs 更安靜 | ✅ **已答（2026-07-31）**：**加進去就直接附 ID**（加 bot 的目的就是拿 ID，最省事）· 關鍵字保留為再取一次的管道 |
| **OQ-GID-4** | 長期要不要讓客戶**完全不碰原始 ID**（notify 也改按名字選）？ | 若是，通用 bot 只是過渡；但它成本極低，留著當「進階/驗證」管道也無妨 | 留待日後 · 不擋 M1 |

---

## 10. M1 落地紀錄（2026-07-31）

**程式碼**（已實作、tsc 綠、3 測試綠）：
- `line_bot` 加 `kind`（`analysis`｜`utility`），`tenant_id` 放寬為 nullable，
  CHECK 保證 analysis bot 仍必有租戶（migration `0054_line_bot_utility_kind.sql`）。
- `line-webhook.service.ts`：驗簽後、進 ingestion 主線**之前**，若 `bot.kind==='utility'`
  走獨立分支：只在 `join` / 關鍵字`群組ID` 回覆該群 ID，其餘全忽略，早退。
  同群 30 秒去重（依 LINE event timestamp）。回覆走既有 `replyTasks`（免費 reply token）。
- `test/group-id-utility-bot.test.ts`：守 FMEA P0 —— utility bot 回 ID 但**不建 line_group**。

**上線需人工執行（R10）**：
1. **上 prod migration** `0054`（單獨 psql 套，勿跑整包 migrate —— 會覆寫 policy）。
2. **在 LINE Developers 建一個新 channel**（aiproot 平台用，非某租戶）。
3. **註冊為 utility bot**（tenant_id 為 NULL）· 用與 server 相同的 `LINE_CONFIG_ENC_KEY`：
   ```sql
   INSERT INTO line_bot (tenant_id, name, bot_user_id, kind,
                         channel_secret_enc, channel_access_token_enc, status)
   VALUES (NULL, '群組 ID 小幫手', '<bot 的 LINE user id · Uxxxx>', 'utility',
           pgp_sym_encrypt('<channel secret>', current_setting('...')),  -- 用同一把 enc key
           pgp_sym_encrypt('<channel access token>', '<enc key>'), 'active');
   ```
4. **LINE console 把 webhook URL 設成同一個** `POST /line/webhook`（destination 自動分流）。
5. **smoke**：把它加進一個測試群 → 應立即收到含群 ID 的歡迎訊息；打「群組ID」→ 再收一次。
   驗 `line_group` 沒有為該群新增列（P0）。

**待辦**：M2 客戶手冊（加 bot→取 ID→貼後台→移除）＋通訊管道頁「新群待分派」標記。

---

## 9. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-31 | v0.4 | **M1 落地**（§10）· line_bot 加 kind（analysis｜utility）+ tenant_id 放寬 nullable（migration 0054）· webhook 驗簽後、進 ingestion 前，utility bot 走獨立分支只回群組 ID（join 附 ID + 關鍵字`群組ID` + 30s 去重）· 3 支測試守 P0（回 ID 但不建 line_group）· tsc 綠、相關 line-bot 回歸綠 · 上 prod 需人工：套 0054 + 建 channel + 註冊 utility bot 列 + 設 webhook URL + smoke | ahern + Claude Code |
| 2026-07-31 | v0.3 | OQ 全數裁定：關鍵字＝`群組ID`、加群直接附 ID · M0 CLOSED · M1 可開工 | ahern + Claude Code |
| 2026-07-31 | v0.2 | ⭐ 用戶裁定：**另建 aiproot 獨立「通用 bot」專職回群組 ID，與租戶分析 bot 分開** · 化解 v0.1 標為決定性 P0 的租戶歸屬問題（通用 bot 不落庫/不分析/不查租戶＝沒有錯置可能）· §4 改為通用 bot 設計（join 附 ID + 關鍵字回 ID + 其餘全忽略、獨立極簡 handler、不進 ingestion 主線）· §5 改為「P0 已由架構化解」· FMEA 重寫（落庫污染改 ✅ 設計上無此路徑；新增「貼錯後台」P1 殘留）· OQ-GID-1 標為已答 · 里程碑收斂為 M0/M1/M2 | ahern + Claude Code |
| 2026-07-31 | v0.1 | M0 首版 · 起於「怎麼讓客戶快速取得群組 ID」· 查證現況：群組已自動註冊+抓群名（後台按名字選、不碰 ID）、webhook 關鍵字→回覆機制成熟 · ⭐ 拆出兩個不同需求（A 連結群組=不該碰 ID / B 真的要 ID=給最快自助管道）· 站在巨人肩膀上四法（命令回覆/加群歡迎/自動註冊按名字選/配對碼）· 主方案＝群組關鍵字「群組ID」回覆（建在既有 pattern，零新機制）· ⭐⭐ 揭露更大的問題：若「固定 bot」是**全體共用一支**，租戶歸屬才是真難題，需改走「群組認領」設計（OQ-GID-1 為決定性前提）· FMEA 含共用 bot 跨租戶 P0 | ahern + Claude Code |
