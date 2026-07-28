# channel-adapter · 通訊通道通用化（介面先想清楚，暫不動工）

> 狀態：🚧 **M0 DRAFT v0.1**（2026-07-28）· **刻意不排期** · 待用戶裁定 OQ-CHA-1..12
>
> 相關：[`ai-analysis-layering.md`](ai-analysis-layering.md)（業種通用化，**與本案是不同的軸線**）、[`tenant-prompt-decoupling.md`](tenant-prompt-decoupling.md)（真正卡住擴展的那一層）、[`convo-analysis-realtime.md`](convo-analysis-realtime.md)（現行 LINE ingest）
>
> ⚠️ **這份文件的定位**：把介面想清楚，**不是**要現在做。
> 沒有第二個平台的真實需求時動工，等於憑想像設計介面 —— 而抽象要有第二個實例才做得對。
> 本文的價值在於：①記下為什麼現在不做 ②列出真的要做時會撞到什麼 ③**現在就該守的紀律**。

---

## 0. 觸發與一個必須先講的釐清

用戶：「產品打算走通用化，未來想從傳統產業擴展到其他產業。」

**但「擴展到其他產業」與「換通訊平台」不是同一條軸線。**

台灣的餐飲連鎖、物流車隊、營建工地、長照機構、診所、批發零售——群組全都在 LINE 上。
從福祉車改裝廠擴展到餐飲或物流，遇到的困難不會是「他們不用 LINE」，而是：

- 日報格式不同（餐飲講班表／耗損／客訴；物流講趟次／簽收／油耗）
- 主檔不同（不是機台工位，是門市／車輛／路線）
- 口語不同

**這三件事全在 L2 業種模板 + L3 租戶主檔，不在通訊層。**

| 擴展軸線 | 需要什麼 | 現況 |
|---|---|---|
| **業種通用化** | L2 模板 + L3 每家自己的主檔 | ⚠️ **卡住** —— L1/L3 鎖在 `tenant-twh.ts`，主檔是假的（見 tenant-prompt-decoupling） |
| **ERP 通用化** | Source Connector | 已宣示，Ragic 現接 |
| **通道通用化（本案）** | Channel Adapter | 只有**出海**或**換客層**才真的需要 |

> **結論先講**：想做通用化，第一哩路是拆掉 `tenant-twh.ts` 硬編，不是本案。
> 本案的觸發條件見 §7。

---

## 1. 現況耦合盤點（實測）

184 個 TypeScript 檔中有 **107 個**提到 LINE。但要分清楚兩種耦合：

| 類型 | 數量級 | 遷移難度 |
|---|---|---|
| **只是表名**（query 寫 `line_message`、`line_group`） | 多數 | **低** —— 邏輯本身平台中立 |
| **真正的 LINE API 耦合** | `line-ingest`(14) `notify`(12) `employee-binding`(5) | **高** |

現有 LINE 專屬資料表 5 張：`line_bot` / `line_group` / `line_member` / `line_message` / `line_media`。

### 1.1 意外的好消息：核心假設已經是最低共同標準

系統被 LINE 逼著建在「**bot 只能被動收 webhook、拿不到歷史訊息**」上
（見 `pitfall_line_bot_no_fetch_history`）。這曾經是痛點——客戶要「同步歷史訊息」我們做不到。

但正因如此，**加平台是加法不是重寫**：Discord／Slack 的能力只會比 LINE 多。
這是被限制逼出來的架構紅利。

---

## 2. 平台能力矩陣（抽象的真正難點）

| 能力 | LINE | Discord | Slack | Telegram | WhatsApp Business |
|---|---|---|---|---|---|
| 事件傳遞 | HTTP webhook | **WebSocket Gateway** | HTTP webhook 或 Socket Mode | webhook 或 long poll | HTTP webhook |
| 歷史訊息 API | ❌ 沒有 | ✅ 有 | ✅ 有 | ❌ bot 拿不到 | ❌ |
| 群組層級 | 一層（group） | **兩層**（guild → channel） | **兩層**（workspace → channel） | 一層（chat） | 一層 |
| 成員名單 | ✅（bot 需在群內） | ✅ | ✅ | 部分 | ❌ |
| 主動推播 | **計費** | 免費 | 免費 | 免費 | 模板訊息 + 計費 |
| 回覆 token | ✅ 有時效、免費 | 無此概念 | 無此概念 | 無 | 24 小時客服窗口 |
| 媒體保存 | **URL 24hr 過期** | CDN 長期 | 長期 | 有時效 | 有時效 |
| 內嵌網頁（打卡用） | LIFF | ❌ 無等價物 | Modal / App Home | Web App | ❌ |
| 台灣傳統產業使用率 | **壓倒性** | ≈ 0 | 少數科技業 | 少 | 少 |

**抽象的兩難就在這張表**：

- 若取**最低共同標準** → Discord／Slack 最有價值的「一次匯入半年歷史」用不到
- 若讓**能力外洩** → 抽象很薄，價值存疑

→ 本文主張：**明確承認能力不對等，用 capability 描述子表達**（§4.2），不假裝一致。

---

## 3. ⭐ 三個會逼架構改變的差異（不是換個 client 就好）

這一節是本文最重要的部分。以下三點**不能靠介面抽象吸收**，會往上打到部署與產品。

### 3.1 Discord 需要長連線，我們現在是無狀態 HTTP

Discord 的訊息事件走 **Gateway（WebSocket）**，不是 HTTP webhook。
（Discord 的 "Webhook" 是**發訊息進去**用的，收不到別人的訊息。）

我們現在是 Render 上的無狀態 HTTP 服務。接 Discord 意味著：

- 需要一個**維持長連線的常駐 worker**，不能休眠、不能隨請求擴縮
- 斷線重連、session resume、shard 管理都要自己顧
- 多副本部署時**同一個 bot 只能有一條連線**，否則事件重複

**這是部署形態的改變，不是加一個 adapter 檔案。**
Slack 的 Socket Mode 也有同樣問題（但 Slack 可以改用 HTTP Events API 迴避）。

> 影響 §10 的里程碑：Discord 必須跟 Slack／Telegram 分開評估，
> 它不只是「第 N 個平台」，是第一個需要常駐連線的平台。

### 3.2 兩層頻道結構打到「群 → 部門」的對應

現行模型是**一層**：一個 LINE 群 → 一個部門（`line_group.department_id`）。

Discord／Slack 是**兩層**：伺服器／工作區 → 頻道。一家公司一個 workspace、底下十幾個 channel。

要決定的是：
- 部門對應到 **channel**（細，但一個 workspace 會產生大量待分派的 channel）
- 還是對應到 **workspace**（粗，等於整家公司一個部門，失去現在的部門隔離）

現行的部門 RLS（`group_owner` 只看自己部門）是**整個權限模型的基礎**，
這一題答錯會連帶打壞戰情室、任務看板、素材看板的範圍控制。

### 3.3 互動介面沒有共同分母

外勤打卡走 LIFF（LINE 內嵌瀏覽器，可拿定位、可帶 LINE 身分）。

| 平台 | 等價物 | 落差 |
|---|---|---|
| Discord | **沒有** | 只能外開瀏覽器，身分要另外串 |
| Slack | Modal / App Home | 拿不到定位 |
| Telegram | Web App | 較接近 LIFF |
| WhatsApp | 沒有 | 只能外開連結 |

→ **打卡不應該進 Channel Adapter 的抽象範圍**（§6）。它是 LINE-only 功能，
換平台就是重做，硬抽象只會做出一個沒人能實作的介面。

---

## 4. 介面設計

### 4.1 分層

```
ChannelAdapter（介面）
├─ 入站：normalize(平台原始事件) → ChannelEvent
├─ 出站：send(ChannelMessage) → 送出
├─ 查詢：fetchMembers / fetchMedia
└─ capabilities：這個平台能做什麼（見 4.2）
```

**核心原則：adapter 只負責「翻譯」，不負責「決定」。**
落庫、分析、materialize、戰情室一律吃正規化後的 `ChannelEvent`，不認得平台。

### 4.2 ⭐ capability 描述子（本設計的關鍵）

不要假裝平台一致。上層要能明確問「這個平台做不做得到」，而不是呼叫下去才發現 throw。

```ts
interface ChannelCapabilities {
  fetchHistory: boolean;        // 能不能回頭抓歷史訊息（LINE ❌ / Discord ✅）
  memberRoster: boolean;        // 能不能列群成員
  freePush: boolean;            // 主動推播免不免費（LINE ❌ · 影響通知設計）
  replyWindow: "token" | "session" | "none";   // 回覆機制
  mediaExpiry: "immediate" | "long";           // 是否必須即收即存
  nestedChannels: boolean;      // 是否兩層結構（§3.2）
  embeddedWebview: "liff" | "webapp" | "modal" | "none";  // §3.3
  transport: "webhook" | "gateway";            // 是否需要常駐連線（§3.1）
}
```

**用途舉例**：
- `fetchHistory === false` → 前端不顯示「同步歷史訊息」按鈕（今天是寫死不顯示）
- `freePush === false` → 通知模組優先用 reply token，並在成本頁計費
- `mediaExpiry === "immediate"` → 啟用即收即存（LINE R13），Discord 可延後下載省流量

### 4.3 正規化事件

```ts
interface ChannelEvent {
  platform: "line" | "discord" | "slack" | "telegram" | "whatsapp";
  tenantId: string;
  externalGroupId: string;      // 平台的群/頻道 id（原樣保留）
  externalParentId: string | null;  // 兩層結構的上層（guild/workspace）· 一層平台為 null
  externalUserId: string | null;
  messageType: "text" | "image" | "video" | "audio" | "file" | "sticker" | "location" | "other";
  text: string | null;
  media: { fetch: () => Promise<Buffer>; contentType: string | null } | null;
  sentAt: Date;
  raw: unknown;                 // 平台原始事件 · 存底供 replay（現行已這樣做）
}
```

> `media.fetch` 刻意做成 **lazy callback** 而不是先下載好的 Buffer：
> LINE 必須即收即存（URL 24hr 過期），Discord 可以晚點再抓。
> 由 capability 決定何時呼叫，adapter 不替上層決定。

### 4.4 出站

```ts
interface OutboundMessage {
  target: { externalGroupId: string } | { externalUserId: string };
  blocks: TextBlock | ButtonBlock | TableBlock;   // 語意區塊，不是平台格式
  replyTo?: string;             // 有 reply token 的平台用；沒有的平台忽略
}
```

**語意區塊而非平台格式**：現在通知模組直接組 LINE Flex Message JSON。
抽象後應改成「我要一段文字＋兩顆按鈕」，由 adapter 譯成 Flex／Discord Embed／Slack Block Kit。
表達力取交集會很陽春——這是要接受的代價（OQ-CHA-6）。

---

## 5. 資料模型遷移策略

### 5.1 主張：加 `platform` 欄位，不要改表名

改 5 張表的名字要動 107 個檔案，**高風險低報酬**。

```sql
ALTER TABLE line_message ADD COLUMN platform text NOT NULL DEFAULT 'line';
ALTER TABLE line_group   ADD COLUMN platform text NOT NULL DEFAULT 'line',
                         ADD COLUMN external_parent_id text;   -- 兩層結構用
```

表名留著當歷史包袱可以接受，語意由 `platform` 欄位承擔。
**真的要改名時再一次改完**，不要邊做邊改（改到一半最危險）。

### 5.2 身分對應

`user_line_binding` 需擴成 `user_channel_binding(user_id, platform, external_user_id)`。
一個人可能同時綁 LINE 與 Slack —— 主鍵要是 `(user_id, platform)` 不是 `user_id`。

> 現況綁定率只有 10%（42 人中 4 人）。多平台會讓這個數字更難看，
> 因為每個平台都要各綁一次。這是**產品問題不是技術問題**（OQ-CHA-9）。

---

## 6. 明確**不**抽象的東西（劃界）

抽象最常見的失敗是抽太多。以下明確排除：

| 項目 | 為什麼不抽象 |
|---|---|
| **外勤打卡（LIFF）** | 沒有共同分母（§3.3）· 硬抽會做出沒人能實作的介面 |
| **LINE Login 綁定流程** | 每個平台 OAuth 差異大，各自實作比抽象清楚 |
| **reply token 計費邏輯** | LINE 獨有的成本結構，其他平台沒有這個概念 |
| **Flex Message 細節版型** | 只做語意區塊（§4.4），版型交給各 adapter |
| **群組建立／邀請流程** | 客戶手動操作，不走程式 |

---

## 7. ⭐ 觸發條件（什麼時候才動工）

**不要因為「產品聽起來要通用」而動工。** 以下任一成立才開 M1：

1. **有具體客戶／潛在客戶在用非 LINE 平台**，且該案子有實際金額
2. **出海**：目標市場 LINE 不是主流（印尼菲律賓 WhatsApp／中國 WeChat／歐美 Slack）
3. **換客層**：目標從傳統產業轉向科技／遠端團隊／社群營運（Discord 的地盤）

**都不成立時的正確做法是 §8 的紀律，不是寫程式。**

> 2026-07-28 現況：三條**都不成立**。台灣福祉還沒正式導入，
> 而擴展到其他傳統產業**不需要**換平台（§0）。

---

## 8. 現在就該守的紀律（零成本）

即使不動工，寫新東西時守住這幾條，未來接第二個平台會便宜很多：

| 紀律 | 例子 |
|---|---|
| 新表用**中性欄位名** | `external_user_id` 而非 `line_user_id` |
| 新 service／module **名稱不放 LINE** | ✅ 今天的 `media/`（不是 `line-media/`） |
| 新端點**不叫 `/line-*`** | ✅ `GET /media`、`GET /audit` |
| 平台專屬邏輯**集中在 `line-ingest/`** | 不要讓 reply token 的概念漏到戰情室 |
| 「LINE 做不到」的事**記成產品邊界** | 例：沒有歷史訊息 API —— 是平台限制不是待辦 |

> 這五條建議寫進 `AGENTS.md`，成為每次動工前會看到的東西。

---

## 9. 失效場景反思（FMEA · R17）

| # | 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|---|
| **F-1** | 抽象時機 | 沒有第二個實例就設計介面 → 第一個真實平台接上時發現介面錯，改兩次 | **白做** | **P0** | §7 觸發條件 · 本文只到 M0 不進 M1 |
| **F-2** | 權限 | 兩層頻道結構下部門對應設計錯 → 部門 RLS 失效 | **跨部門資料外洩** | **P0** | §3.2 必須在 M1 前定案 · 沿用既有部門判斷式不另開 |
| **F-3** | 部署 | Discord 長連線 worker 掛掉無人察覺 → 訊息靜默漏收 | **資料缺漏且不自知** | **P0** | 心跳落庫 + 「最後收到訊息時間」告警 · 不可只靠 process 存活 |
| **F-4** | 部署 | 多副本各開一條 Gateway 連線 → 事件重複入庫 | 重複分析、重複計費 | **P1** | 訊息 id 冪等（現行已有 `message_id` PRIMARY KEY）· 單副本鎖 |
| **F-5** | 能力落差 | 上層假設所有平台都能做某事，呼叫下去才 throw | 功能半殘 | **P1** | capability 描述子（§4.2）· 前端依 capability 決定要不要顯示按鈕 |
| **F-6** | 表達力 | 語意區塊取交集 → LINE 現有的 Flex 通知變陽春 | 既有體驗退步 | **P1** | 保留 escape hatch：adapter 可接受平台原生 payload（但只在必要時用） |
| **F-7** | 綁定 | 多平台後每人要綁多次，綁定率更低 | 歸屬更難 | **P1** | 這是產品問題 · 待認領流程已能吸收（task-to-personal-report） |
| **F-8** | 成本 | 各平台 rate limit／計費模型不同，成本模型失準 | 帳單意外 | P2 | 成本頁按平台分列 |
| **F-9** | 遷移 | `platform` 欄位加了但舊查詢沒帶條件 → 跨平台資料混在一起 | 資料錯亂 | P2 | 加欄位時同步 sweep 所有查詢（`rule_outer_shell_sweep`） |

---

## 10. 開放問題（OQ-CHA-N）

| # | 問題 | 建議 |
|---|---|---|
| **OQ-CHA-1** | 現在要不要動工？ | **不要** · 三個觸發條件都不成立（§7） |
| **OQ-CHA-2** | 第一個要接的非 LINE 平台是誰？ | **不是 Discord** · 若出海走 WhatsApp／WeChat；Discord 是換客層才需要 |
| **OQ-CHA-3** | 兩層頻道怎麼對部門？ | ❓ **M1 前必須定案**（F-2 P0）· 傾向 channel 層，但要解決「大量待分派 channel」 |
| **OQ-CHA-4** | 改表名還是加 `platform` 欄位？ | **加欄位**（§5.1）· 改名動 107 檔，高風險低報酬 |
| **OQ-CHA-5** | 打卡要不要納入抽象？ | **不要**（§6）· 沒有共同分母 |
| **OQ-CHA-6** | 出站訊息用語意區塊還是平台原生？ | **語意區塊為主 + escape hatch**（§4.4 · F-6） |
| **OQ-CHA-7** | Discord 的常駐 worker 放哪？ | ❓ Render 需另開 background worker（不能休眠）· 成本與監控待評估 |
| **OQ-CHA-8** | 有歷史訊息 API 的平台要不要做「一次匯入」？ | **要** · 那是 Discord／Slack 相對 LINE 的最大賣點（新客戶第一天就有半年資料） |
| **OQ-CHA-9** | 多平台綁定怎麼降低摩擦？ | ❓ 現行 10% 綁定率已是痛點 · 多平台會更差 |
| **OQ-CHA-10** | 要不要支援「一家公司同時用兩個平台」？ | **要**（資料模型天然支援）· 但 UI 要能分辨來源 |
| **OQ-CHA-11** | 現有 `line_*` 表最終要不要改名？ | 要，但**一次改完**，不要邊做邊改（§5.1） |
| **OQ-CHA-12** | §8 的紀律要不要寫進 AGENTS.md？ | **要** · 這是本文現在唯一該落地的東西 |

---

## 11. 里程碑（**刻意不排期**）

| 里程碑 | 內容 | 前提 |
|---|---|---|
| **M0** | 本文件 + OQ 裁定 ← 目前在這 | — |
| **M0.5** | §8 紀律寫進 `AGENTS.md` | **現在就做** · 零成本 |
| **M1** | 資料層加 `platform` + `external_parent_id`；定案兩層頻道對部門（OQ-CHA-3） | §7 觸發條件任一成立 |
| **M2** | 抽 `ChannelAdapter` 介面 + capability；把現行 LINE 實作套進去（**行為不變**） | M1 |
| **M3** | 第二個平台實作（依 OQ-CHA-2 決定是誰）· HTTP webhook 類優先 | M2 |
| **M4** | Gateway 類平台（Discord／Slack Socket Mode）+ 常駐 worker + 心跳告警 | M3 · **部署形態改變** |
| **M5** | 有歷史 API 的平台做「一次匯入」（OQ-CHA-8） | M3 |

> **M2 是 gate**：把 LINE 套進新介面後，行為必須完全不變
> （同 `tenant-prompt-decoupling` M1 的原則：純搬移那一步不要順手改善，
> 否則之後出問題分不清是誰造成的）。

---

## 12. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-28 | v0.1 | M0 首版 · 用戶要求「就算暫不動工，先把介面想清楚」· **先釐清軸線**：擴展到其他傳統產業**不需要**換平台（台灣各業種都用 LINE），真正卡住的是 `tenant-twh.ts` 硬編 · 實測耦合 107/184 檔，但多數只是表名、邏輯本身平台中立 · **意外發現架構紅利**：系統被 LINE 逼在「被動收、無歷史」的最低共同標準上，加平台是加法不是重寫 · **三個逼架構改變的差異**：①Discord 走 WebSocket Gateway 不是 webhook → 需要常駐 worker，是部署形態改變（F-3 P0 靜默漏收）②Discord／Slack 兩層頻道結構會打到部門 RLS（F-2 P0）③互動介面（LIFF）沒有共同分母 → 明確排除在抽象範圍外 · 主張 capability 描述子而非假裝一致、加 `platform` 欄位而非改表名、語意區塊 + escape hatch · **§7 明列觸發條件，三條現在都不成立** · §8 五條零成本紀律建議寫進 AGENTS.md · FMEA 9 條含 3 個 P0 · OQ-CHA-1..12 | ahern + Claude Code |
