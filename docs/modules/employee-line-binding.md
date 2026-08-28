# employee-line-binding.md — [Priority-1] 員工 LINE 身分綁定機制

> ✅ **狀態：APPROVED · 方向 8 · LIFF Zero-Config（2026-07-22 用戶拍板）**
>
> **拍板決定**：方向 8 · LIFF + 員工列表選擇（v0.6 新增 · v0.6.4 定案）
> - Alice 全程在 LINE 內完成（不需登入網頁 · 不需記密碼 · 不需打員工編號）
> - Zero-Config：無需 CSV 匯入 · line_member 自動 pre-fill
> - 一次綁定 · 兩處識別：LINE UserId 對同 bot 唯一 · 群組 + 私訊都自動對到王愛麗絲
> - 業助最少工作量（< 1h/100 員工）
> - 準確性 99.99%（LINE UserId 技術認證）
> - LINE 群組名為 UI label（Alice 熟）· 系統靜默對應 department_id
>
> **待批次 OQ 裁定**：OQ-ELB-2 (資料模型) / 3-7 (實作細節)
>
> 版本歷程：v0.1 (4 方向) → v0.5 (framing 修正) → v0.6 (加方向 6/7) → v0.6.1-4 (層層釐清) → **v1.0 · 方向 8 APPROVED**
>
> Scope: **完整規劃「員工 LINE UserId ↔ aiproot 系統身分」的綁定機制** — 4 方向徹底分析 · 各方向的資料模型 / UI 流程 / edge case / 風險 / 遷移路徑；本 doc 不 lock 方向 · 提供批次 OQ 時全景資訊。
>
> **為什麼獨立一份 doc**：綁定機制是**跨模組基石** · 不只功能二個人日報用 · 未來多個 feature 都會 depend on it：
> - 台灣福祉功能二 · LINE 個人日報回報（1-on-1 私訊 → 系統認得 Eric）
> - Warroom 任務 assign 到員工 · 員工登入看自己（[[warroom-task-board]] OQ-WTB-3）
> - 個人化通知 · aiproot / 主管 push 給某員工的 LINE（[[warroom-task-board]] OQ-WTB-4）
> - 稽核追蹤 · 「這則訊息確實是 Eric 發的」（現有 line_member.user_id 已有 · 但沒對應 users）
> - 未來簽核 · 員工自己在 LINE 回「已完成」（v2 需求）
>
> **產品哲學重要性**：
> - CLAUDE.md §0 「不改變工廠員工的 LINE 使用習慣」— 綁定流程若太複雜 · 員工不配合 · 整個功能崩
> - **選錯方向的代價很大**：綁 100 員工錯了 · rework 是**成倍**成本（每人重綁一次 + 澄清 + 主管信任損傷）
> - 相對地 · **設計得對可長期複用** · 是 aiproot 平台的核心資產
>
> **依賴上游**：
> - [[line-ingest]] v1.0 — line_member.display_name / user_id 已有
> - [[tenant-provisioning]] v1.0 — users.email / display_name / role 已有
>
> 相關 module：
> - [[convo-analysis-realtime]] · 訊息 sender_line_id 已在 line_member
> - [[warroom-task-board]] · 任務 assignee 可 link users
> - `personal-daily-report`（未來 M0-B）· 完全依賴此機制
>
> 作者：Claude Code（草擬）
> 版本：v0.1（2026-07-22）


## v3（2026-08-28）· ⭐ 員工可以自己選主要群 —— 推翻 v2 的「不讓員工選」

**v2 的理由第 2 條被實例推翻。** 原文：

> 2. UserId 是 LINE 保證的技術認證 · 群組活動也是 · **系統推斷比人工可靠**

實際：有員工發言最多的部門群，並不是他真正歸屬的部門。

> **「發言最多」量到的是社交活躍度，不是組織歸屬。**
> 這兩件事本來就不保證一致，而我們一直當它們是。

### 不是全開，是有邊界地開

v2 的其餘三條理由仍成立，所以加了四道邊界：

| # | 邊界 | 為什麼 |
|---|---|---|
| 1 | 只能從**他自己近 30 天發過言的群**裡選 | `POST /binding/liff/complete` 是 `@Public()`。少這條，任何人都能把自己塞進任一部門 |
| 2 | 只能選**已分派部門 + `group_type='department'`** 的群 | 否則產出會歸到不存在的組織單位（0068 那條註解） |
| 3 | 自選寫 `department_source='manual'` | migration 0052：手動優先、**永不被自動推導覆寫**。員工選過的與主管改過的一樣受保護 |
| 4 | 驗證失敗**丟錯不靜默退回自動推斷** | 靜默退回會讓使用者以為選好了，系統卻用別的答案 |

### UI：預設仍在，只是可以改

系統推斷的第一名仍是**預設選取**，多數人直接按「確認綁定」——
**判斷次數維持 0**，只有推斷錯的人才需要動作（memory `feedback_novice_comfort_is_the_moat`：
「多一次點擊可以，多一次選擇不行」）。

⚠️ 預設是「第一個**選得了部門**的群」，不是 `groups[0]` ——
`groups[0]` 可能是未分派部門或公告群，那種當預設會讓提示寫出一個空部門。

選不了的群**照樣顯示**（員工要看得到自己的全貌），標「未分派部門」且不可點。

### 已知殘留

員工**從沒在自己部門群發過言**的話，那個群不會出現在清單裡 →
維持 `unassigned_needs_manager`，由 tenant_admin 於「部門/成員」頁指派。
這是既有的 fallback，本次不變。

守門測試：`server/test/binding-self-select-group.test.ts`（7 條，含 4 道邊界逐條釘住）。

---

## 1. Why · 這個決策為什麼重要

### 1.1 影響範圍

綁定機制不 lock 好 · 以下所有 feature 都動不了：

| Feature | 需要的綁定深度 | 現況 gap |
|---|---|---|
| 個人日報回報 | 私訊 bot → 認得是 Eric → 到 5:30 自動整理 → 通知 Eric 登入看 | 全套 · 無 |
| 任務 assign 到員工 | Ticket.assignee 對到 aiproot user 帳號 · 員工看得到自己的 | 部分（display_name 已在 line_member）· 缺 user link |
| 個人化通知 push | 系統要 push 給某員工 · 需知他 LINE UserId | line_member 有 UserId · 缺 aiproot user link |
| 稽核「這訊息確實 Eric 發的」 | line_message.sender_line_id 對到 aiproot user | 現匿名顯示 · 需 link |
| 簽核回饋（LINE 直接回「已完成」）| Bot 認得員工 · 更新 tickets 狀態 | 全套 · 無 |

### 1.2 選錯的代價

**方向 1（自服務）選錯 · 員工 UI 太複雜不用** → 綁定率 20% · 個人日報 feature 只覆 20% 員工 · 主管不信任 · 淘汰 feature

**方向 2（手動填）選錯 · 業助工作量爆** → aiproot 業助成日在填 mapping · scale 不到 10 家客戶

**方向 3（推導）選錯 · display_name 不一致** → 王小明綁到「Wang C」錯人 · 主管日報看到別人的內容 · 信任崩盤

**方向 4（混合）選錯 · 複雜度失控** → 3 條路徑都要維護 · bug 面積 3 倍

### 1.3 產品哲學對齊

CLAUDE.md §0：「不改變工廠員工的 LINE 使用習慣」

翻譯：
- 員工「原本就會做」的動作 = OK · 例如「在群組裡發訊息」/「私訊 bot」
- 員工「要學新流程」的動作 = 摩擦大 · 例如「登入網頁」/「掃 QR」/「輸入 email」
- **設計指標**：綁定成功前 · 員工需要學 ≤ **1 個新動作**

---

## 2. 需求與約束

### 2.1 功能需求

1. **員工唯一性**：綁定完成後 · 系統能唯一識別「這個 LINE UserId = aiproot 系統的某 user」
2. **抗冒名**：Alice 不能綁到 Bob 的帳號（安全）
3. **可撤銷**：員工離職 / 換手機 · aiproot 可解除綁定
4. **可 audit**：什麼時候誰綁誰的 · 有 log
5. **多租戶隔離**：台灣福祉的員工 · 只綁到台灣福祉 tenant

### 2.2 非功能需求

1. **員工端 UX 摩擦最小化**：藍領工廠員工不熟登入 · 越少步驟越好
2. **Aiproot 業助工作量控制**：aiproot 業助 1 人可負荷 5-10 家客戶 · 每家 100 員工 · 不能爆
3. **綁定完成率**：pilot 客戶第一週 > 60% · 第一月 > 90%
4. **綁錯修復成本**：綁錯 · 修復流程 ≤ 3 步

### 2.3 上游能提供什麼（現有 asset）

**已有**：
- `line_member` 表 · 記 (bot_id, group_id, user_id, display_name, picture_url) · **來自 LINE profile API 拉取**（很有價值 · 這是關鍵訊息）
- `users` 表 · 記 (user_id, tenant_id, email, display_name, role) · **aiproot / 客戶開通時建立**
- Bot 帳號 · 「鮮湧」「台灣福祉」等 · 每 tenant 一 bot · 已能收 webhook

**還沒有的**：
- 綁定關係表（`user_line_binding` 或直接在 users 表加欄）
- 綁定流程的前端 UI（登入頁 / QR 頁 / bot reply flow）
- Bot 主動回訊息的能力（現只被動收 · 若走方向 1/4 需要）

### 2.4 硬約束

- **LINE Messaging API 條件**：拉 group member profile 需該 user 已在群發過訊息（webhook consent）· 但 **1-on-1 私訊 profile 是無條件的**（reply token 可用）
- **員工不會用 email + password 記憶模式** · 除非 aiproot 教過（跟客戶協調成本）
- **LINE UserId 不等於群裡的 display_name** · 有時甚至完全不同（叫「王小明」但 LINE 名叫「小明的手機」）
- **一個員工可能加多個 tenant 的 bot**（e.g. 跨 tenant 顧問）· 需支援多綁定

---

## 3. 資料模型 · 4 方向共用

無論走哪方向 · 資料模型基礎是共用的：

```sql
-- migration 0017_employee_line_binding.sql · 概念
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS line_user_id text,          -- 綁定的 LINE UserId (Uxxx)
  ADD COLUMN IF NOT EXISTS bound_at     timestamptz;   -- 綁定時間

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_line_user_id
  ON users (line_user_id) WHERE line_user_id IS NOT NULL;

-- 或若考慮 multi-binding（同員工不同 tenant）· 抽獨立表
CREATE TABLE IF NOT EXISTS user_line_binding (
  binding_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  bot_id          uuid NOT NULL REFERENCES line_bot(bot_id) ON DELETE CASCADE,
  line_user_id    text NOT NULL,                       -- LINE UserId (Uxxx)
  bound_at        timestamptz NOT NULL DEFAULT now(),
  bound_by        uuid REFERENCES users(user_id),      -- 誰執行綁定（可能 aiproot / user 自己）
  binding_method  text NOT NULL,                       -- 'self_service' | 'aiproot_manual' | 'auto_infer'
  status          text NOT NULL DEFAULT 'active'       -- 'active' | 'revoked' | 'pending'
    CHECK (status IN ('active', 'revoked', 'pending')),
  UNIQUE (bot_id, line_user_id)                        -- 同 bot 下 · 一個 LINE UserId 只綁一個 user
);

-- RLS tenant_isolation (JOIN users → users.tenant_id)
```

**選擇**：抽獨立表比 users 加欄好 · 因為：
- 支援 multi-binding（同員工不同 tenant）
- 綁定歷史（audit）
- 綁定方法區分（self_service / manual / auto_infer · 可統計成功率）

---

## 4. 方向 1 · 員工自服務綁定

### 4.1 概念

員工登入 aiproot → 系統顯示綁定頁面 → 一次性 token + Bot QR → 員工掃 QR 加 bot → 私訊 bot 貼 token → 系統驗 → 綁定成功。

### 4.2 詳細流程

**Step A · 員工首次登入 aiproot**
```
GET /login → 員工用 aiproot 帳號密碼登入
GET /me → 系統看 user_line_binding 表 · 沒 binding
    → 顯示 「你還沒綁定 LINE · 請完成綁定才能使用個人日報功能」
    → 導向 GET /binding/setup
```

**Step B · 綁定頁面**
```
GET /binding/setup:
  - 產一次性 token (16-24 char · TTL 10 min · 存 redis or user_line_binding.pending row)
  - 顯示：
    - 「請掃描 QR code 加入公司 LINE bot」
    - Bot QR image (from line_bot.qr_code_url · LINE Console 提供)
    - 「加好友後 · 私訊 bot 貼上這串驗證碼：ABC123DE」
    - Token 剩餘時間倒數
```

**Step C · 員工掃 QR + 私訊 bot**
```
員工 LINE 加 bot → 私訊 bot 「ABC123DE」
webhook 收到 message event · type=text · source.type='user' (非 group)
Backend:
  - 若 !groupId · 現在的邏輯是 continue skip · 需擴 · 加 1-on-1 handling
  - 查 pending token · 找到對應的 pending binding
  - 綁定：user_line_binding.line_user_id = event.source.userId · status=active
  - Bot 回覆訊息（reply token）：「綁定成功！你是 Eric。以後私訊我就會自動整理成日報」
```

**Step D · 綁定完成**
```
員工重刷 aiproot 頁面 → 顯示「LINE 已綁定 · UserId: Uabc...123」
之後私訊 bot 就會走個人日報 pipeline
```

### 4.3 資料模型 delta

除了 §3 共用 model · 需：
- `binding_method='self_service'`
- Pending token 存 memory (Redis) or DB · 建議 DB · 簡單易查

### 4.4 前端 UI

**新頁**：`/binding/setup`
- QR code 圖片
- Token 顯示（大字體 · 好抄 · 例：`ABC-123-DE`）
- 剩餘時間倒數
- 「重新產 token」按鈕
- 「已完成綁定」按鈕（刷新狀態）

### 4.5 Backend delta

**LINE webhook 擴 · 支援 1-on-1**：
```typescript
// line-webhook.service.ts
if (!groupId) {
  // 新增 1-on-1 handling · 現在直接 continue
  if (event.type === "message" && event.message?.type === "text") {
    await this.handleDirectMessage(bot, event);
  }
  continue;
}

async handleDirectMessage(bot: BotWithSecret, event: DirectMessageEvent) {
  const userId = event.source.userId;
  const text = event.message.text.trim();

  // 查 pending binding
  const pending = await this.bindingRepo.findPendingByToken(text);
  if (pending) {
    await this.bindingRepo.complete(pending.bindingId, {
      lineUserId: userId,
      boundAt: new Date(),
    });
    await this.lineApi.replyMessage(event.replyToken, `綁定成功！你是 ${pending.userDisplayName}`);
    return;
  }

  // 若已綁定 · 走個人日報 pipeline (功能二 M0-B 範圍)
  const bound = await this.bindingRepo.getByLineUserId(bot.botId, userId);
  if (bound) {
    await this.personalPipeline.enqueueMessage(bound.userId, text);
    return;
  }

  // 未綁定 · 回禮貌訊息
  await this.lineApi.replyMessage(event.replyToken,
    "請先到 aiproot 網站完成綁定 · 才能使用個人日報功能");
}
```

**Bot reply API**：現 `LineApiClient` 沒 replyMessage · 需擴：
- LINE Messaging API `POST /v2/bot/message/reply` · 用 replyToken · 免費（不占 push quota）

### 4.6 Effort 估算

- Backend: 5 天
  - migration + repo + service (2 天)
  - webhook 擴 1-on-1 handler (1 天)
  - LineApiClient.replyMessage (0.5 天)
  - Pending token 生成 + 驗 (1 天)
  - Tests (0.5 天)
- Frontend: 3 天
  - `/binding/setup` 頁 (QR 顯示 + token + 倒數) (2 天)
  - 未綁定 gate（登入後強制導綁定頁）(0.5 天)
  - `/me` 顯示綁定狀態 (0.5 天)
- 客戶端配合: 1 天（跟客戶協調 · 員工 onboarding 說明）

**合計 · 9 天工程 + 1 天客戶協調**

### 4.7 Pro / Con

**Pro**：
- ✅ Scale · 客戶自服務 · aiproot 業助零介入
- ✅ 資安好 · token 有時效 · 用戶主動 opt-in
- ✅ 綁定過程明確 · 有 audit（bound_at, method）
- ✅ 可重新綁（換手機時走同流程）
- ✅ 未來擴其他功能（e.g. 員工自己設密碼）走同 pattern

**Con**：
- ⚠️ 員工要「登入 aiproot」+「掃 QR」+「私訊 bot」= 3 個新動作 · **摩擦大**
- ⚠️ 藍領員工可能不會 email/password 登入 · 需 aiproot 教
- ⚠️ 若員工不主動 · 綁定進度慢 · 主管催不動
- ⚠️ 沒登入密碼要重置 · 需 aiproot 業助介入 · 部分 self-service 失效

### 4.8 Edge cases

- **Token 過期**：員工掃了但沒立即輸入 · 10 分鐘後 fail · 需重產
- **私訊給錯 bot**：客戶多 tenant · 員工加錯 bot 私訊 · Token 對不到 · 明確錯誤訊息
- **員工手機不支援 QR**：提供 URL 版本（`https://line.me/R/ti/p/@botId`）
- **員工已加 bot 好友 · 但沒進登入頁**：token 找不到 · bot 回「未綁定」
- **員工登入 A 帳號 · 掃 B 同事的 QR · 私訊 bot 貼 A 的 token**：token 是 A 的 · 綁到 A 上 · Bob 的 LINE 卻綁到 Alice → **需檢查一次 UNIQUE (bot, line_user_id)**

---

## 5. 方向 2 · Aiproot 業助手動填

### 5.1 概念

Aiproot 業助拿到客戶員工名單（姓名 + email） → 進「LINE 機器人 → 成員」頁 → 逐個對應 line_member.display_name → 填 users.email → 建 binding。

### 5.2 詳細流程

**Step A · 客戶交員工名單**
- 台灣福祉業助給 aiproot 業助 Excel：`姓名 | email | 部門 | LINE 顯示名`
- 或線下確認每人 LINE 名字

**Step B · Aiproot 業助建 users**
- 進「AIPROOT 管理 → 開通新租戶」（若還沒開）· 建各員工 users 帳號
- 或現有 wizard 只建 admin · 需擴 wizard 或加「批次匯入員工」功能

**Step C · Aiproot 業助綁 line_member ↔ users**
- 進 新頁「LINE 機器人 → 成員綁定」
- 顯 line_member 表所有記錄（display_name + user_id 末 6 位）
- 每 row 有下拉 · 選對應 users（顯示 email + display_name）
- 儲存 · binding 落庫（method='aiproot_manual', bound_by=aiproot admin）

### 5.3 資料模型 delta

除了 §3 共用 model · 需：
- `binding_method='aiproot_manual'`
- 加 `bound_by = <aiproot admin user_id>` 標記
- Users 表可能需批次 import 功能

### 5.4 前端 UI

**新頁**：「AIPROOT 管理 → LINE 成員綁定」
- 過濾 · by tenant / by bot
- Table:
  - LINE display_name (line_member.display_name)
  - LINE UserId 末 6 位（audit 用）
  - 加入群數（幾群見過）
  - 對應 users 下拉（顯 email · display_name · 已綁的用灰 disabled）
  - 儲存 / 撤銷
- 進度條「200 人 · 已綁 45 · 剩 155」

**現有 wizard 擴** or **新頁 「批次匯入員工」**：
- Aiproot 貼 CSV：`email, display_name, department, role`
- 系統批次建 users · 之後綁 line_member

### 5.5 Backend delta

**新 endpoint**：
- `GET /aiproot-console/line-member-binding?tenantId=xxx` · 列 line_member + 對應 users(if bound)
- `POST /aiproot-console/line-member-binding` body: `{ lineUserId, userId }` · 建 binding
- `DELETE /aiproot-console/line-member-binding/:bindingId` · 撤銷
- 批次 users import endpoint（可選）

### 5.6 Effort 估算

- Backend: 3 天（endpoint + repo · 較 direction 1 少 webhook 1-on-1 handling）
- Frontend: 4 天
  - 綁定頁 UI（可能複雜 · 100 rows 表格 + 進度）(3 天)
  - 批次 import UI（若做）(1 天)
- 客戶端配合: 每客戶 0.5-1 天（客戶要出員工名單 · aiproot 逐筆填）

**合計 · 7 天工程 + 每客戶 0.5-1 天業助時間**

### 5.7 Pro / Con

**Pro**：
- ✅ 員工零門檻 · 完全被動
- ✅ 可控性最高 · 綁誰 aiproot 說了算
- ✅ 綁定精準（aiproot 對員工資料負責）
- ✅ 適合小規模（單一 tenant < 30 員工）

**Con**：
- ⚠️ Aiproot 業助工作量大 · 每 100 員工 = 2 小時填表 + 對員工資料
- ⚠️ 客戶端要出員工名單 · 有隱私議題（LINE 名 + email 對照）
- ⚠️ 員工 LINE 名不熟 aiproot 業助 · 綁錯風險高
- ⚠️ 員工離職 · 客戶要記得通知 · 否則舊 binding 一直在
- ⚠️ 沒 scale · 5-10 家客戶就是 aiproot 業助的 20% 工時

### 5.8 Edge cases

- **員工同名**（王小明 A / 王小明 B）· 靠部門 or 手機末 4 碼區分
- **LINE 名字改動**（王小明變小明的手機）· 需重新對應
- **客戶名單不全**（新進員工沒交）· 綁定 lag · 該員工個人日報 fail
- **綁錯**（A 綁到 B）· 修法：aiproot revoke + 重綁 · 需審核流程避免疏忽

---

## 6. 方向 3 · 群組推導（**⚠️ 不當綁定主手段 · 降級為未綁定偵測工具**）

> **v0.3 重要更新（2026-07-22）**：經進一步分析 · **方向 3 不適合作為綁定主手段**：
> - 沒有任何驗證行為 · 綁定關係無法稽核（暱稱可改、可撞名、可能是英文綽號或空白）
> - LINE Messaging API 硬約束：**沒有「群組全成員 UserId list」endpoint 給一般 channel**
>   - 只有 `GET group/{gid}/summary`（群名）· `members/count`（人數）· `member/{userId}`（需先知 userId）
>   - 只能靠 webhook 收到訊息時補 · **靜默用戶永遠推導不出**
> - **重定位**：改當「**未綁定偵測 / 綁定 nudge 工具**」· 不當綁定路徑
>   - 系統掃 `line_member` · 交叉查 `user_line_binding` · 標出「這 5 個 UserId 一直在發言但沒綁」
>   - aiproot / 主管 dashboard 提醒「該追這幾個」
>   - 這樣避開 accuracy 問題 · 保留分析價值

### 6.1 原設計（歷史保留 · **不採用**）

系統看 `line_member` 表已知的 LINE display_name · 對到 `users` 表 display_name 相同的 user · 自動 propose 綁定 · aiproot / tenant_admin 確認即成。

### 6.2 詳細流程

**Step A · Aiproot 建 users 表**
- 開通 tenant + 部門 · 建各員工 users 帳號（帶 display_name）
- 這一步跟方向 2 同 · 客戶需交員工名單

**Step B · 系統自動 propose**
- 定期跑 job（e.g. 每小時）· scan line_member · 對到 users
- Match 邏輯（fuzzy）：
  - 完全相同 · e.g. 「王小明」= users.display_name「王小明」→ 高信度 propose
  - 包含 · e.g. 「王小明」in 「王小明_品保」→ 中信度
  - 拼音 · e.g. 「wang xiao ming」 vs 「王小明」→ 需拼音 library · 低信度
- 落 pending binding：`status='pending', binding_method='auto_infer', match_confidence`

**Step C · Aiproot / tenant_admin 確認**
- 進「LINE 成員綁定」頁 · 顯 pending 建議
- 每 row 顯 propose 對應 · 「確認」/「否認 · 改指定」/「延後」
- 高信度批次確認 · 低信度逐個 review

**Step D · 綁定生效**
- Confirmed pending 轉 active · 系統開始用該 binding

### 6.3 資料模型 delta

除了 §3 共用 model · 需：
- `binding_method='auto_infer'`
- 加欄 `match_confidence text` 記推導信度（high/medium/low）
- 加欄 `match_evidence jsonb` 記推導依據（e.g. `{ line_name: "王小明", user_display: "王小明", method: "exact_match" }`）

### 6.4 前端 UI

**新頁 or 現有頁擴**：「LINE 成員綁定」（同方向 2）
- 頂 tab：Pending review / Bound / Unbound
- Pending 顯 auto_infer 結果 · 每 row 有 confidence icon（🟢🟡🔴）
- 批次確認高信度（一次點 20 個）
- 低信度需逐個 · 顯 evidence 給 aiproot 參考

### 6.5 Backend delta

- 新 service `EmployeeAutoInferService` · 定期跑
- Fuzzy match logic · 中文比對 + 拼音 fallback
- Pending binding CRUD endpoint

### 6.6 Effort 估算

- Backend: 6 天（fuzzy match 邏輯難 · 中文特別）
- Frontend: 3 天（複用方向 2 UI + confidence 顯示）
- 客戶端配合: 每客戶 0.3-0.5 天（aiproot 逐個確認）

**合計 · 9 天工程 + 每客戶 0.3-0.5 天業助時間**

### 6.7 Pro / Con

**Pro**：
- ✅ 半自動 · 人工只 confirm 不建立
- ✅ 對員工零門檻（跟方向 2 同）
- ✅ 適合員工名字規範化的 tenant（e.g. HR 要求 LINE 用真名）
- ✅ Confidence 分級 · 可批量確認

**Con**：
- ⚠️ 依賴 display_name 一致 · 現實中不穩定
- ⚠️ 拼音 library 中文效果差
- ⚠️ 綁錯風險高（AI propose 錯 · aiproot review 疏忽 · 綁到別人）
- ⚠️ Cold start 難：新員工還沒 users 表 · propose 對不上
- ⚠️ 需先做方向 2 的部分（建 users 表）

### 6.8 Edge cases

- **員工 LINE 用暱稱**「小明的手機」· 對不到 users 「王小明」→ 顯 unbound
- **同名不同人**（王小明 A / 王小明 B）· propose 兩筆 · aiproot 選錯
- **員工改 LINE 名字**（結婚改姓）· 舊 binding 仍指 A · 需 revoke + re-propose
- **Users 尚未建**（新客戶 pilot · aiproot 還沒收員工名單）· 無 propose 可做

### 6.9 重新定位 · 「未綁定偵測」用法（推薦）

**這才是方向 3 該有的角色 · 不是綁定 · 是輔助工具**：

```
系統定期跑 job（e.g. 每天 08:00 batch 後）：
  1. SELECT DISTINCT sender_line_id
     FROM line_message
     WHERE tenant_id = X AND sent_at > now() - '7 days'
  2. LEFT JOIN user_line_binding
  3. WHERE binding.status IS NULL OR binding.status != 'active'
  4. → 這是「近 7 天有發言但未綁定」的 UserId 清單

輸出：
- aiproot 業助 dashboard 顯：「台灣福祉有 12 個活躍 LINE 用戶未綁定 · 建議追」
- tenant_admin dashboard 顯：「你們公司有 12 位員工需要綁定」
- 每筆顯 line_member.display_name + 部門（若可推） + 最近訊息時間
- 「送綁定邀請」按鈕 → 依實際綁定方向觸發（方向 6 bot 私訊 or 方向 1 email 邀請）
```

**這個 nudge 機制 · 適合搭配所有其他方向**（1/2/4/5/6）· 提高綁定率但不當綁定手段。

**LINE API 限制不影響此用法**：
- 靜默用戶偵測不到 · 但他們也不會發訊息影響戰情室分析 · 對業務**無 loss**
- 只有活躍用戶（有發言）才會出現 · 這正是「需綁定」的目標人群

### 6.10 更新 · Effort 估算（作為 nudge 工具）

- Backend: 2 天（1 個定期 job + 1 個 endpoint）
- Frontend: 1 天（dashboard widget）

**合計 · 3 天** · 遠少於原方向 3 的 9 天（不用做 fuzzy match / auto-approve 流程）

---

## 7. 方向 4 · 混合（推薦架構）

### 7.1 概念

**三條路徑並存 · 依情境自動選 · 覆蓋率最高**：

1. **預設走方向 3**（自動推導 propose）· 系統背景跑 · 高信度 auto-approve · 低信度待 review
2. **手動 fallback 走方向 2**（aiproot 補填）· auto_infer 對不到的 · aiproot 用 UI 補
3. **員工自服務走方向 1**（自 opt-in）· 已建 users 的員工 · 進 aiproot 自主綁定 · 加速首發

### 7.2 使用情境

**Tenant 首發（前 2 週）**：
- Aiproot 建員工 users（客戶交名單 · 方向 2 前置）
- 系統背景跑 auto_infer（方向 3）· 3-5 天內完成 60-70% 綁定
- 剩下 30-40% · 走方向 2 手動 or 方向 1 員工自服務

**Tenant 穩定期**：
- 新員工加入 · 客戶通知 aiproot → 建 users → 自動 auto_infer → 若 match 上就自動綁 · 否則待 review
- 現有員工換手機 · 走方向 1 員工自服務重綁

### 7.3 資料模型 delta

除了 §3 共用 model · 完整支援 3 種 method：
- `binding_method IN ('self_service', 'aiproot_manual', 'auto_infer')`

### 7.4 Effort 估算

- Backend: 12-14 天（3 路徑全做）
  - 方向 1 的 webhook 1-on-1 + reply
  - 方向 2 的 endpoint
  - 方向 3 的 auto_infer service + fuzzy match
- Frontend: 8-10 天
  - 員工自服務綁定頁
  - Aiproot 成員綁定頁（含 pending review + manual add + status filter）
- 客戶端配合: 1-2 天

**合計 · 20-24 天工程 · 3-4 週日曆時間**

### 7.5 Pro / Con

**Pro**：
- ✅ 覆蓋率最高（3 路徑互補 · pilot 客戶 90%+ 兩週達成）
- ✅ 場景匹配（快員工 self-opt · 保守員工被動 · aiproot review 保底）
- ✅ 未來擴展路徑（新加 SSO？加社群 sign-in？只需擴 method）

**Con**：
- ⚠️ 開發成本最高（20-24 天）· 對 pilot 期可能過度
- ⚠️ 3 路徑一致性維護（e.g. 3 個入口都得處理 line_user_id 已被別人綁的錯誤）
- ⚠️ 給 aiproot 業助 3 種 UI · 需 training · 可能反而搞混

### 7.6 Phase-in 落地計畫（若選方向 4）

不建議一次全開 · 分 3 phase：

**Phase A · 1-2 週**：只做方向 2（手動填）· 保底可用
**Phase B · 2-3 週**：加方向 3 auto_infer · 減 aiproot 工作量
**Phase C · 3-4 週**：加方向 1 self_service · 減新員工綁定 lag

Phase A 就可讓功能二 M0-B 上線（部分覆蓋）· Phase B/C 之後擴到 90%+

---

## 7-bis. 方向 5 · 層層驗證高保證（99.99%+）

### 7-bis.1 概念

「一個人是 Alice」這事 · **需至少 3 個獨立來源 confirm**：
1. **Alice 本人主動 opt-in**（她私訊 bot 貼 token · 只有她能拿到 token · 只有她能提供 UserId）
2. **Alice 的主管人工 confirm**（有 audit · 有信任責任）
3. **綁定後給 Alice 反悔通知**（bot 私訊「你已被綁定 · 非本人請立即撤銷」）

外加**時間軸保護**：
- 30-60 天 periodic revalidation（防綁定後員工換手機沒通報）
- LINE display_name / picture 變動觸發 re-verify（防 stale binding）
- Alice 隨時可自己 revoke（不必透過 aiproot 業助）

### 7-bis.2 詳細流程

```
┌── 前置（每 tenant onboarding 1 次）
│  Step 0. Aiproot 業助建 users · 客戶交名單（姓名 + email + 部門 + **主管是誰**）
│         · users 表 supervisor_user_id 欄記
├── 綁定（每員工 1 次）
│  Step 1. Alice 登入 aiproot · 首次改密碼 · 導綁定頁
│  Step 2. 綁定頁顯 QR + 一次性 token (TTL 10 分鐘)
│         · 顯 Alice 部門 + 主管姓名（確認登對帳號）
│  Step 3. Alice 加 bot 好友 + 私訊 token
│         · Bot 建 pending binding · 回「已收到 · 送主管審核」
│         · 主管收 aiproot 通知「Alice 提交綁定申請」
│  Step 4. 主管進 aiproot「待審綁定」頁 · 看：
│         · Alice LINE 頭貼 + display_name
│         · Alice 最近在哪些群發過訊息（line_member 歷史）
│         · Alice 部門對不對 → approve / reject
│  Step 5. Approve 後：
│         · Binding.status = active
│         · Bot 主動私訊 Alice「綁定完成 · 若非本人請立即到 aiproot 撤銷」
│         · Audit log 記：who 提交 · who approve · when
└── 定期保護（自動）
   Guard A. 每 60 天 · bot 私訊「你仍在使用此帳號嗎？回 Yes 續」
            · 沒回 30 天標 stale
   Guard B. LINE display_name / picture 變 · 標 needs_reverify
            · 主管收通知重新確認
```

### 7-bis.3 資料模型 delta

除 §3 共用 model · 需：
- `user_line_binding.status` 加 `'pending_supervisor_approval'` 狀態
- 加欄 `supervisor_user_id uuid` · 記由誰 approve（沿用 users.supervisor_user_id）
- 加欄 `approved_at timestamptz` · `approved_by uuid`
- 加欄 `last_revalidated_at timestamptz` · `revalidation_status text`
- Users 表加欄 `supervisor_user_id uuid REFERENCES users(user_id)`

### 7-bis.4 前端 UI

**新頁 A · 「待審綁定」**（主管視角）：
- 我需審核的綁定 pending 列表
- 每 row：Alice 姓名 · Alice LINE 頭貼縮圖 · display_name · 部門 · 提交時間
- Click → drawer 顯 Alice line_member 歷史（她在哪幾群發過訊息 · 頻率）
- 「這是 Alice · Approve」/「不是 Alice · Reject」按鈕

**新頁 B · 「員工綁定狀態」**（Alice 視角）：
- Alice 登入 aiproot · 首頁顯自己綁定狀態：
  - 未綁定 · 進綁定
  - Pending · 等主管審核（顯主管姓名）
  - 已綁定 · 顯 line_user_id + 綁定日期
  - 需重新驗證（Guard B 觸發）
- 「撤銷綁定」按鈕（Alice 自己可 revoke）

**新頁 C · 「綁定 audit」**（aiproot 全公司）：
- 全 tenant × 全 binding 的 audit trail
- 篩選：who / when / method / status change

### 7-bis.5 Backend delta

**LINE webhook 擴 1-on-1**（同方向 1）· 但綁定 pending 狀態改為需 supervisor approve：
```typescript
async handleDirectMessage(bot, event) {
  const token = event.message.text.trim();
  const pending = await this.bindingRepo.findPendingByToken(token);
  if (pending) {
    // 不 auto complete · 改建 pending_supervisor_approval
    await this.bindingRepo.setPendingSupervisorApproval(pending.bindingId, {
      lineUserId: event.source.userId,
    });
    // 通知主管
    await this.notify.sendSupervisorApprovalRequest(pending.supervisorUserId, {
      employeeName: pending.userDisplayName,
      lineUserId: event.source.userId,
    });
    // 回 Alice
    await this.lineApi.replyMessage(event.replyToken,
      `已收到綁定申請 · 送主管 ${pending.supervisorDisplayName} 審核`);
  }
}
```

**新 endpoint**：
- `GET /binding/supervisor/pending` · 主管看 pending 列表
- `POST /binding/supervisor/approve/:bindingId` · approve
- `POST /binding/supervisor/reject/:bindingId` · reject
- `POST /binding/self/revoke` · Alice 自己 revoke
- `POST /binding/supervisor/force-revalidate/:bindingId` · 主管強制 revalidate

**新 cron / 定期 job**：
- Guard A · 每天掃 binding · 過 60 天未 revalidate 的 → bot push 私訊
- Guard B · 每天掃 line_member · display_name 或 picture_url 變動 → 觸發 needs_reverify

**Bot push 通知**（LINE push message · 需 push quota）：
- 綁定完成通知 Alice
- Guard A 定期問候

### 7-bis.6 Effort 估算

- Backend: 12-14 天
  - 方向 1 全套（webhook 1-on-1 + reply · 5 天）
  - 主管 approve 流程 (endpoint + notify · 3 天)
  - Guard A + B 定期 job (2 天)
  - Users 加 supervisor_user_id + wizard 擴 (2 天)
- Frontend: 6-8 天
  - 綁定頁（Alice 視角 · 3 天）
  - 待審綁定頁（主管視角 · 3 天）
  - Audit 頁（aiproot 視角 · 2 天）
- 客戶端配合: 每客戶 1-2 天（Aiproot 建 users + 主管 training）

**合計 · 18-22 天工程 + 每客戶 1-2 天業助**

### 7-bis.7 Pro / Con

**Pro**：
- ✅ **接近 100% 準確**（99.99%+）· 3 個獨立來源 confirm
- ✅ **可 audit** · 每步驟有 log · 綁錯可追責
- ✅ **可撤銷** · Alice 自己 revoke / 主管 force revoke / aiproot revoke 三管道
- ✅ **時間軸保護** · 60 天 revalidate + LINE 變動觸發
- ✅ **社工攻擊防護** · 主管會人工看頭貼確認 · 冒名極難
- ✅ 對高規產業（醫療 / 金融 / 政府）合適
- ✅ 對補助計畫 demo 有信任加分

**Con**：
- ⚠️ **員工端摩擦最高** · 3 步 + 等主管 approve（可能 1-2 天）
- ⚠️ **主管負擔** · 每員工 approve 一次 · 主管沒 buy-in 就卡
- ⚠️ **綁定時間長** · 100 員工 pilot · 兩週才完成
- ⚠️ **開發成本最高** · 18-22 天 · 對 pilot 可能過度
- ⚠️ **依賴主管網絡** · 若客戶沒明確主管制度 · 走不通

### 7-bis.8 Edge cases

| 場景 | 處理 |
|---|---|
| 主管一直沒 approve | Aiproot admin 有「代 approve」權限（audit 記） |
| Alice 換手機 · 舊 binding 死掉 | Guard A 60 天觸發 → 主管收通知 · 主管確認後 Alice 走綁定流程重跑 |
| Alice 離職 · 主管沒 revoke | Users soft delete 觸發 cascade revoke · 保 audit trail |
| Alice 主管本身沒綁定 · 無法收通知 | 主管綁定用 aiproot admin 代 approve · 主管綁完後鏈條完整 |
| 主管誤 approve 綁錯 · Alice 收到通知 revoke | Revoke 完 · 標 disputed · aiproot review |
| 兩個 Alice 同時提交（同名不同人）· 主管看頭貼分辨 | 主管 approve 時 · 兩筆 pending 並列顯 · 靠頭貼 + LINE display_name 差異分辨 |

### 7-bis.9 為什麼 99.99%+（錯法對照表）

| 錯法 | 這設計怎麼防 |
|---|---|
| Bob 拿 Alice 的 token 私訊 · 綁到 Alice | Alice 登入才產 token · Bob 沒 Alice 密碼 · 拿不到 |
| Alice 密碼被猜 · Bob 綁自己 LINE 到 Alice | 主管 Step 4 review · 頭貼跟名字不對 · reject |
| aiproot 業助填錯部門 / 主管 | Step 4 主管 approve · Alice 若非該部門 · 主管認不出 |
| Alice 綁完 · Bob 拿 Alice 手機再綁 | Bot 私訊「你已被綁定」· Alice 沒申請就撤銷 |
| Alice 換手機 · 舊 LINE 死掉 · 沒通報 | Guard A 60 天檢查 · Alice 沒回 · 標 stale · 主管重新走流程 |
| Alice 改 LINE 暱稱（結婚改姓） | Guard B 觸發 · 主管確認 |

---

## 7-ter. 方向 6 · Bot-Native + 業助覆核（員工摩擦最低 · 99.9%）

### 7-ter.1 概念

**全程在 LINE 內完成 · 員工不跨裝置 · 不碰網頁** — 綁定由 bot 端發起 · 員工回覆兩個資訊（員工編號 + email）· aiproot 業助覆核 · 綁定完成。

**核心設計**：**「Bot-native + 三層依賴 confirm」**
1. **員工雙欄位驗證**（員工編號 + email）· 冒用門檻高（要拿到 Bob 的**兩個**資訊才能冒名）
2. **業助覆核**（人工看 LINE 頭貼 + 名字判斷）· 抓雙欄位共同對但仍錯的情境
3. **綁後 bot 通知員工**（「你已被綁定 · 若非本人請立即聯繫業助」）· 被冒者收到就發覺

**設計理念**：
- 對員工：**只 2 個動作**（加 bot 好友 + 回訊）· 全在 LINE 內
- 對主管：**零負擔**（用業助代替方向 5 的主管網絡）
- 對業助：每員工 30 秒 approve · 100 員工約 50 分鐘
- 對 aiproot：只需前置建 users 表（員工編號 + email · 客戶交名單即得）

### 7-ter.2 詳細流程

```
┌── 前置（每 tenant onboarding 1 次）
│  Step 0. Aiproot 業助建 users
│         · 客戶交員工名單 (姓名 + 員工編號 + 公司 email + 部門)
│         · users 表加欄 employee_no · email 已有
│         · 客戶內部宣告「員工加公司 bot 好友 · 依 bot 提示提供編號 + email 完成綁定」
├── 綁定（每員工 1 次 · 全在 LINE 內）
│  Step 1. Alice 加 bot 好友
│         · LINE 觸發 follow event → webhook 收
│
│  Step 2. Bot 主動私訊（reply follow event · 免費）：
│         「歡迎！請提供你的員工編號 + 公司 email 完成綁定
│          格式：EMP001 alice@twhomecare.com.tw」
│
│  Step 3. Alice 私訊回覆「EMP001 alice@twhomecare.com.tw」
│         · webhook 收 message event
│
│  Step 4. Bot parse 訊息 · 雙欄位比對 users 表
│         · WHERE tenant_id = <bot 的 tenant> AND employee_no = X AND email = Y
│         · 若對得上 · 建 pending binding · 通知業助
│         · 若對不上 · bot 回「員工編號或信箱不符 · 請確認後再試」
│
│  Step 5. 業助收 aiproot 通知
│         · 進「待審綁定」頁 · 看：
│           - Alice 姓名 (from users) + 部門
│           - Alice LINE 頭貼 + display_name
│           - Alice 最近在哪些群發過訊息（line_member 歷史）
│         · Approve / Reject
│
│  Step 6. Approve 後
│         · Binding.status = active
│         · Bot 主動私訊 Alice：「綁定完成 · 你是 Alice · 若非本人請立即聯繫業助」
│         · Audit log · 記提交時間 / 業助 approve 時間 / 匹配的 employee_no + email
└── 定期保護（自動）
   Guard A · 每 60 天 · bot 私訊「你仍在使用此帳號嗎？回 Yes 續」
   Guard B · LINE display_name / picture 大變 · 標 needs_reverify
```

### 7-ter.3 資料模型 delta

除 §3 共用 model · 需：
- `binding_method='bot_native_supervisor_reviewed'`
- Users 表加欄 `employee_no text` · UNIQUE (tenant_id, employee_no)
- `user_line_binding.status = 'pending_aiproot_review'`（不同於方向 5 的 supervisor）
- `user_line_binding.approved_by`（aiproot 業助 user_id）
- `user_line_binding.match_evidence jsonb`（記錄「employee_no+email 對到 users.user_id」）

### 7-ter.4 前端 UI

**新頁 A · 「待審綁定 (aiproot)」**：
- 全 tenant × 全 pending binding 列表
- 每 row：租戶 · Alice 姓名 · Alice LINE 頭貼 · display_name · 部門 · 提交時間
- Click → drawer 顯 Alice line_member 歷史（她在哪幾群發過訊息）
- 「這是 Alice · Approve」/「不是 Alice · Reject」按鈕

**新頁 B · 「員工綁定狀態」**（Alice 視角 · 若有 aiproot 帳號才顯）：
- 員工登入 aiproot（若有）· 顯自己綁定狀態
- 但方向 6 員工可能沒 aiproot 帳號 · 這頁 optional

**Bot 回覆規範**（LINE 群發格式）：
- 歡迎訊息含綁定指引
- 錯誤訊息（雙欄位對不上）· 說「請確認公司交給你的資訊」
- 綁定成功 · 說明用途 + 撤銷方式

### 7-ter.5 Backend delta

**LINE webhook 擴 · 支援 follow event 與 1-on-1 message**：
```typescript
async processWebhook(rawBody, signature) {
  // ... existing 驗簽
  for (const event of payload.events!) {
    // ...
    if (!groupId) {
      // 1-on-1 · 新增 follow 與 message handling
      if (event.type === "follow") {
        await this.sendBindingInvite(bot, event);
      }
      if (event.type === "message" && event.message?.type === "text") {
        await this.handleBindingReply(bot, event);
      }
      continue;
    }
    // ...
  }
}

async sendBindingInvite(bot, event) {
  await this.lineApi.replyMessage(event.replyToken, [
    "歡迎！請提供你的員工編號 + 公司 email 完成綁定",
    "格式：EMP001 alice@twhomecare.com.tw",
  ]);
}

async handleBindingReply(bot, event) {
  const text = event.message.text.trim();
  const match = text.match(/^(\S+)\s+(\S+@\S+)$/);
  if (!match) {
    await this.lineApi.replyMessage(event.replyToken,
      "格式錯誤 · 請用：EMP001 alice@twhomecare.com.tw");
    return;
  }
  const [, employeeNo, email] = match;
  const user = await this.userRepo.findByEmployeeNoAndEmail(bot.tenantId, employeeNo, email);
  if (!user) {
    await this.lineApi.replyMessage(event.replyToken,
      "員工編號或信箱不符 · 請確認後再試");
    return;
  }
  // 建 pending binding · 通知業助
  await this.bindingRepo.createPending({
    userId: user.userId,
    botId: bot.botId,
    lineUserId: event.source.userId,
    method: "bot_native_supervisor_reviewed",
  });
  await this.notify.sendAiprootReviewRequest({
    tenantId: bot.tenantId,
    userDisplayName: user.displayName,
    lineUserId: event.source.userId,
  });
  await this.lineApi.replyMessage(event.replyToken,
    "已收到綁定申請 · 送審核中");
}
```

**新 endpoint**：
- `GET /binding/aiproot/pending` · aiproot 業助看待審列表
- `POST /binding/aiproot/approve/:bindingId` · approve
- `POST /binding/aiproot/reject/:bindingId` · reject
- `POST /binding/self/revoke` · Alice bot 私訊「撤銷」也走同 endpoint

### 7-ter.6 Effort 估算

- Backend: 8-10 天
  - Webhook follow / 1-on-1 message handler (2 天)
  - LineApiClient.replyMessage (0.5 天)
  - User + binding repo 擴 (2 天)
  - Aiproot approve endpoint (1 天)
  - Guard A + B 定期 job (2 天)
  - Notify 業助 integration (0.5 天)
- Frontend: 4 天
  - 待審綁定頁（aiproot 視角 · 3 天）
  - Audit dashboard（1 天）
- 客戶端配合: 每客戶 0.5-1 天（Aiproot 建 users · 內部宣告）

**合計 · 12-14 天工程 + 每客戶 0.5-1 天業助**

### 7-ter.7 Pro / Con

**Pro**：
- ✅ **員工端摩擦最低**（6 個方向裡最低）· 2 個動作 · 全在 LINE
- ✅ 不跨裝置 · 藍領員工友善
- ✅ **無主管網絡依賴**（vs 方向 5）· 業助代替
- ✅ **雙欄位驗證** · 冒用門檻高
- ✅ 業助覆核 + 綁後通知 · 準確 99.9%
- ✅ 對 pilot / 首發客戶 · 快速上線（12-14 天 vs 方向 5 的 18-22 天）
- ✅ 可 audit · 每步驟有 log

**Con**：
- ⚠️ 依賴員工正確提供編號 + email · 若客戶溝通不清 · 員工不知自己編號 → lag
- ⚠️ 業助工作量存在（vs 方向 5 主管代替）· 但比方向 2 少（不用手動填 · 只 approve）
- ⚠️ 準確性 99.9% vs 方向 5 的 99.99% · 差在業助不像主管熟員工 · 靠 LINE 頭貼 + 名字判斷可能 miss 冒名
- ⚠️ 客戶需有明確員工編號制度（工廠通常有 · 但小公司可能沒）

### 7-ter.8 Edge cases

| 場景 | 處理 |
|---|---|
| 員工不知道自己員工編號 | 客戶內部宣告時附編號查詢管道 · 或改用「員工姓名 + 手機末 4 碼」雙欄位 |
| 員工加 bot 好友但不回訊 | Bot 隔 3 天發提醒（占 push quota · 或改為登入 dashboard 顯提醒 = 方向 3 的 nudge） |
| 業助一直沒 approve | Aiproot admin 可代 approve · audit 記 |
| Alice 綁完 · Bob 拿 Alice 手機再綁 | Bot 回「該 employee_no 已綁定」· 需先 revoke |
| 兩員工同名 | employee_no 是 UNIQUE key · 不會撞 |
| 員工同時提供 A email + B employee_no | 雙欄位對不上 users 表 · bot 回錯誤訊息 |
| 員工在多 tenant（跨顧問）| bot_id 決定 tenant_id · 各 tenant 各自綁 |

### 7-ter.9 準確性設計（三層依賴 confirm · 99.9%）

| 層 | 誰做 | 抓什麼 |
|---|---|---|
| L1 · 員工雙欄位 | Alice | 冒用者需拿到 Alice 的**兩個**資訊 · 難度高 |
| L2 · 業助覆核 | Aiproot 業助 | 抓 L1 過但實際是冒名的（頭貼名字對不上）|
| L3 · 綁後通知 | Alice 收 bot 通知 | 被冒者發覺 · 主動撤銷 |
| 保護 · Guard A/B | 系統 cron | 綁定後隨時間變動偵測（換手機 / 改暱稱）|

**vs 方向 5** 的差異：
- 方向 5：3 層獨立來源（員工 opt-in + **主管** approve + 綁後通知）· 主管熟員工 · confirm 更強 → 99.99%
- 方向 6：3 層依賴（員工雙欄位 + **業助** approve + 綁後通知）· 業助不熟員工 · confirm 稍弱 → 99.9%
- 但方向 6 摩擦低更多 · 是**摩擦與準確的甜蜜點**

---

## 7-quater. 方向 7 · LINE Login OAuth 自動綁定（高準確 · 低摩擦 · 最少工時）

### 7-quater.1 概念

**LINE Login OAuth** 是 LINE 提供的**技術認證**服務（不是「業助 / 主管肉眼判斷」）。員工用自己 LINE 帳號授權 aiproot 一次 · 系統自動拿到 LINE UserId · **LINE 服務端保證這 UserId 屬於該持有人**。

**核心設計**：
- **LINE OAuth = 技術認證**（不同於方向 5/6 的人工覆核）· 準確性天生高
- 員工只需 2 動作：aiproot 登入 + LINE 授權（點擊）
- 開發成本最少（不需寫 approve UI · 不需主管網絡 · 不需雙欄位比對）

### 7-quater.2 詳細流程

```
┌── 前置（每 tenant onboarding 1 次）
│  Step 0. Aiproot 業助建 users + 分發一次性密碼
│         · 客戶交名單（姓名 + email + 部門）
│         · 系統產一次性密碼發到 email（reuse tenant_provisioning 的密碼機制）
│  Step 0a. LINE Login channel 開啟
│         · Aiproot 在 LINE Developer Console 開 LINE Login channel
│         · 掛在同一 Provider 下 · 與 Messaging API channel 共用 UserId
│         · Callback URL: https://ai-center-line.onrender.com/auth/line/callback
│
├── 綁定（每員工 1 次 · 全程 < 2 分鐘）
│  Step 1. 員工首次到 aiproot 網頁 · 用一次性密碼登入
│         · 系統要求改密碼（sec baseline）
│
│  Step 2. 系統顯「用 LINE 登入完成綁定」按鈕
│         · 說明「這會綁定你的 LINE 帳號 · 之後私訊 bot 就會自動整理個人日報」
│
│  Step 3. 員工點按鈕 → 跳 LINE OAuth 授權頁
│         · 授權範圍：profile（拿 UserId + display_name + picture）
│
│  Step 4. LINE 授權成功 · redirect 回 aiproot callback
│         · 系統驗 code + 換 access_token + 拿 profile
│         · UPDATE users SET line_user_id = <profile.userId>
│         · Binding 落庫 method='line_login_oauth'
│
│  Step 5. 綁定完成頁
│         · 「你已綁定為 Alice · LINE UserId: Uabc...123」
│         · 「若非本人請立即撤銷」按鈕
│         · Email 通知 Alice 綁定完成（防冒名 · Alice 收到能發覺）
└── 定期保護（自動）
   Guard A · 每 60 天 · aiproot 顯提示「請確認綁定仍有效」
   Guard B · LINE profile 變動 · 自動更新 line_member.display_name / picture
```

### 7-quater.3 資料模型 delta

除 §3 共用 model · 需：
- `binding_method='line_login_oauth'`
- Users 表加欄 `line_user_id text` · UNIQUE (tenant_id, line_user_id)（Nullable · 未綁 = null）
- `user_line_binding.line_access_token_enc bytea`（pgcrypto · 未來 refresh 用 · optional）
- `user_line_binding.oauth_scopes text[]`（記錄 grant 的 scope · 通常 `["profile"]`）

**Env 加**：
- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_SECRET_ENC`（pgcrypto）
- `LINE_LOGIN_CALLBACK_URL`

### 7-quater.4 前端 UI

**擴既有 · 首次登入頁**（reuse tenant_provisioning 的 FirstLoginChangePassword）：
- 員工用一次性密碼登入 · 改密碼
- 完成後跳「綁定 LINE 引導頁」

**新頁 · 綁定 LINE 引導**：
```
歡迎 Alice · 完成綁定就能使用個人日報功能

[圖示: LINE logo + 說明]

[ 用 LINE 登入完成綁定 ]  ← 大按鈕

點按鈕後 · 會跳 LINE 授權頁面 · 允許 aiproot 讀取你的 LINE UserId
```

**綁定完成頁**：
- 顯 LINE UserId + display_name + picture
- 「撤銷綁定」按鈕（Alice 自己隨時可 revoke）

**已綁定的員工首頁**：
- 顯示 LINE 綁定狀態
- 進個人日報 / 任務看板 · 全走已綁定 UserId

### 7-quater.5 Backend delta

**新 endpoint · OAuth callback**：
```typescript
@Get("/auth/line/callback")
async lineCallback(@Query("code") code: string, @Query("state") state: string) {
  // 驗 state (防 CSRF)
  const stateData = await this.oauthState.verify(state);
  if (!stateData) throw new BadRequestException("state 無效");

  // 換 access_token
  const tokenResp = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.LINE_LOGIN_CALLBACK_URL!,
      client_id: process.env.LINE_LOGIN_CHANNEL_ID!,
      client_secret: this.decryptClientSecret(),
    }),
  });
  const { access_token } = await tokenResp.json();

  // 拿 profile
  const profileResp = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const { userId, displayName, pictureUrl } = await profileResp.json();

  // 綁定
  await this.bindingRepo.upsert({
    userId: stateData.userId,
    botId: stateData.botId,
    lineUserId: userId,
    method: "line_login_oauth",
    status: "active",
    boundAt: new Date(),
  });

  // 通知員工 email
  await this.notify.sendBindingCompletedEmail(stateData.userId, {
    lineUserId: userId,
    displayName,
  });

  return { redirectTo: "/binding/success" };
}
```

**新 endpoint · 產 OAuth URL**：
```typescript
@Get("/auth/line/initiate")
async initiate(@CurrentUser() user: JwtUser) {
  const state = await this.oauthState.generate({ userId: user.user_id, botId: /* 由 tenant 決 */ });
  const url = new URL("https://access.line.me/oauth2/v2.1/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.LINE_LOGIN_CHANNEL_ID!);
  url.searchParams.set("redirect_uri", process.env.LINE_LOGIN_CALLBACK_URL!);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "profile");
  return { authorizeUrl: url.toString() };
}
```

### 7-quater.6 Effort 估算

- Backend: 5-6 天
  - LINE Login channel config + secret encrypt (1 天)
  - OAuth callback handler + state 管理 (2 天)
  - Binding upsert + email 通知 (1 天)
  - Users 加欄 + migration (0.5 天)
  - Tests (0.5-1 天)
- Frontend: 3 天
  - 「用 LINE 登入」按鈕 + 授權跳轉 (1 天)
  - Callback landing + 綁定成功頁 (1 天)
  - 綁定管理頁（Alice 視角）(1 天)
- LINE Login channel setup: 0.5-1 天（aiproot 業助在 LINE Developer Console 建）
- 客戶端配合: 每客戶 0.5 天（分發一次性密碼 email）

**合計 · 9-12 天工程 + 每客戶 0.5 天業助**

### 7-quater.7 Pro / Con

**Pro**：
- ✅ **準確性最高**（99.99% · LINE OAuth 技術認證 · 非人肉判斷）
- ✅ **開發成本最少**（9-12 天 · 少於方向 5/6）
- ✅ 員工端摩擦低（2 動作 · 全點擊）
- ✅ **不依賴主管網絡**（vs 方向 5）
- ✅ **不依賴客戶編號制度**（vs 方向 6 · 只需 email）
- ✅ 不需業助 approve（vs 方向 6）
- ✅ 可 audit · 每步驟有 log · LINE 端也留 OAuth token 記錄
- ✅ 未來 SSO / OIDC extension friendly（同 OAuth 家族）

**Con**：
- ⚠️ 員工需登入 aiproot（跟方向 1/5 同 · 藍領員工可能陌生）
- ⚠️ 需開 LINE Login channel（額外設定 · 但一次性）
- ⚠️ 一次性密碼分發到 email · 需員工有 email · 若無公司 email 用個人 gmail 有資料保護議題
- ⚠️ OAuth 授權對員工是抽象概念 · 可能看到「允許授權」畫面猶豫（客戶端需說明）
- ⚠️ 依賴 LINE 服務可用（LINE 全球掛過幾次 · 極少 · 但存在）
- ⚠️ Bot 認證雖不強制 · 但 LINE Login 認證 provider 有加分（提升信任 · 客戶方 CTO 對認證會比較放心）

### 7-quater.8 Edge cases

| 場景 | 處理 |
|---|---|
| 員工手機沒登入 LINE · 點授權跳登入頁 | 引導員工先在瀏覽器登入 LINE · 或用手機瀏覽器直接跳到 LINE App |
| 員工用**私人 LINE** 帳號 · 而非公司預期的 | LINE UserId 就是他私人的 · 綁定生效 · 若客戶介意需在客戶溝通清「請用公司登記的 LINE」|
| 一次性密碼過期（e.g. 7 天）| 員工進登入頁看到 expired · 通知 aiproot 業助重發 |
| 員工誤點「Deny」授權 | LINE callback 帶 error · aiproot 顯「你拒絕授權 · 請重試」|
| Alice 綁完 · Bob 有 Alice email + 密碼 · 用 Bob LINE OAuth 綁 | 綁到 Alice user · Alice 收 email 通知 · 撤銷 · 或 Guard A 60 天 revalidate 抓 |
| 換手機 · Alice 用新 LINE 登入 aiproot 點綁定 | 新 UserId · 觸發 conflict（Alice 已綁舊 UserId）· UI 顯「你已綁定 Uxxx · 是否更換？」需 aiproot 業助 approve 更換 |
| LINE Login channel 未設 · env 缺 | 系統顯「綁定服務未 config · 聯繫 aiproot」· fallback 到方向 2 手動 |

### 7-quater.9 準確性設計

**LINE OAuth 是「技術認證」· 準確性天生 99.99%**：

| 錯法 | 防禦 |
|---|---|
| Bob 用自己 LINE 授權 · 綁到 Bob 自己 users | 綁到 Bob 沒有問題（如 Bob 是自己 login）· 若 Bob 已冒充 Alice 登入 aiproot（拿 Alice 的一次性密碼）· 這是**帳號被盜** · 不是綁定 bug |
| Alice email + 密碼洩漏 · Bob 冒用 | Guard: Bob 綁完 · Alice 收 email 通知「你已綁定」· Alice 撤銷 |
| Bob 拿 Alice 手機 · Alice 已登 LINE · Bob 綁自己 | Bob 需先侵入 Alice 手機 · 這是 device 已被 compromise · 綁定是最小問題 |
| LINE 服務被中間人攻擊 | LINE OAuth 走 HTTPS + PKCE · 技術上難 · 且非 aiproot 責任 |
| Alice 部分授權（拒絕 profile scope）| Callback fail · 綁定不生效 · 提示重試 |

**Guard 加強**（可選）：
- 綁定完 email + LINE push 雙通知（快速發現冒名）
- 60 天 revalidate（防 stale）
- LINE profile 大變（display_name / picture 完全改）自動觸發 needs_reverify

### 7-quater.10 LINE Login channel · 認證考量

**LINE Login 本身不強制認證** · 但認證帶來：
- **審核速度**：認證 provider 開 LINE Login channel · 通常即開即用（未認證需 LINE 手動 review · 可能 1-3 天）
- **信任度**：員工看到 LINE 授權頁「aiproot（藍勾）· 請求存取你的 profile」比純白名字專業
- **提高 quota**：認證帳號 profile API 呼叫上限更高（實務上通常用不到那麼多）

**認證流程**（給客戶方）：
- LINE Developer Console → Provider → 申請認證
- 提交公司資料 · 品牌一致性審核
- 時間 · 2-4 週
- **費用 · 免費**（藍勾）· 綠勾（企業 / 政府）付費

**建議**：Aiproot 主 provider（管所有 tenant bot）認證 · 讓所有客戶 tenant 底下的 LINE Login channel 都受益（省客戶申請時間）。

### 7-quater.11 v0.6 修正 · Alice 真實動作是 6 · 不是 2

原本聲稱 Alice 只 2 動作是**誤簡化**。真實流程 6 動作：
1. 收 email · 記住一次性密碼
2. 打開網頁 · 輸入 email + 密碼登入
3. 首次強改密碼（12 字 + 3 類 · 藍領員工最痛點）
4. 進綁定頁 · 點「用 LINE 登入」
5. LINE OAuth「同意並前進」
6. 加 bot 好友（掃 QR 或連結）

**藍領員工實際摩擦：中-高**（不是「低」）· 主要痛點在 Step 2-3（登入網頁 + 改密碼）。

業助工作也之前少算：
- 除了前置匯入 · 還有**追未綁 + 密碼重置 + 換手機重綁 + audit** 等維護工作
- 實際 · **7-8 小時 / 100 員工**（不是 40 分鐘）

這修正讓方向 7 從「絕佳」變「一般」· 藍領產業應優先考慮方向 8（LIFF）· 見 §7-quinque。

---

## 7-quinque. 方向 8 · LIFF + 員工列表選擇（Alice 全在 LINE 內 · 真正低摩擦）

### 7-quinque.1 概念

**LIFF（LINE Front-end Framework）** 允許在 **LINE App 內開網頁**（WebView）· Alice **從頭到尾不離開 LINE**。

**核心設計**：
- Alice 加 bot 好友 → 點 LIFF link → 網頁在 LINE 內開
- LIFF SDK **自動提供 Alice 的 LINE UserId**（技術認證 · 無需 OAuth 授權按鈕）
- 網頁顯示員工列表 · Alice 選「自己是誰」+ 二次確認
- 無需登入 aiproot 網頁 · 無需記密碼 · 無需輸入編號

### 7-quinque.2 詳細流程

```
┌── 前置（每 tenant onboarding · aiproot 業助）
│  Step 0. 建 users（姓名 + email + 部門）
│         · 不需分發一次性密碼給員工（大改變）
│         · 只需分發「加 bot 好友」QR 給客戶
├── 綁定（每員工 · 全程 < 2 分鐘 · 全在 LINE 內）
│  Step 1. Alice 加 bot 好友（掃 QR 或搜尋）
│         · webhook 收 follow event
│  Step 2. Bot 主動私訊：
│         「歡迎！點下方按鈕完成綁定」+ LIFF link
│  Step 3. Alice 點 LIFF link
│         · LINE App 內開 mini web view
│         · LIFF SDK 自動取得 Alice UserId（技術認證）
│  Step 4. LIFF 網頁顯：
│         · 「請從列表選擇你是誰」
│         · 顯示未綁定員工列表（可依部門篩選）
│         · Alice 點「王愛麗絲 · 品保部」
│  Step 5. 確認頁：
│         · 「你是品保部的王愛麗絲嗎？」
│         · 顯示部門、職稱、email 等資訊供 Alice 對照
│         · 點「是 · 完成綁定」
│  Step 6. Bot 主動私訊：「綁定成功」+ 使用說明
└── 定期保護
   · 每 60 天 · bot 私訊 revalidate
   · 綁定完 email 通知（若客戶有 email · 加 audit trail）
```

**變體 · 高保證 99.99%**（可選）：
在 Step 5 加 Email OTP：
- Alice 選「王愛麗絲」後 · 系統寄 6 位數字碼到 alice@twhomecare.com.tw
- Alice 到公司信箱看碼 · 貼回 LIFF 網頁
- 綁定完成

多 2 動作 · 但抓「Alice 誤選同事」的情境。

### 7-quinque.3 資料模型 delta

除 §3 共用 model · 需：
- `binding_method='liff_self_service'` 或 `'liff_with_email_otp'`
- 新表 `liff_binding_otp` (optional · 若走 OTP 變體)：
  ```sql
  CREATE TABLE liff_binding_otp (
    otp_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL,
    line_user_id text NOT NULL,
    code       text NOT NULL,       -- 6 位數字
    expires_at timestamptz NOT NULL,
    verified   boolean NOT NULL DEFAULT false,
    attempts   integer NOT NULL DEFAULT 0
  );
  ```

**Env 加**：
- `LIFF_CHANNEL_ID` — LIFF channel（新建 · 掛在同 Provider 下）
- `LIFF_ENDPOINT_URL` — LIFF web page URL

### 7-quinque.4 前端 UI

**LIFF 網頁**（4 個畫面 · 在 LINE App 內顯）：

**Page A · 歡迎頁**：
- 顯示 aiproot logo + 「請從下方選擇你是誰」
- LIFF SDK 已在後台取得 Alice UserId · 用戶不知覺

**Page B · 員工列表**：
- 顯示未綁定員工清單（tenant scoped）
- 每 row：姓名 · 部門 · 職稱
- 頂 search box · Alice 可輸入姓氏過濾
- 「找不到你的名字？」→ 說明「聯繫公司資訊窗口」

**Page C · 確認**：
- 「你是品保部的王愛麗絲嗎？」
- 顯 email、職稱等對照資訊
- 大按鈕「是的 · 我是王愛麗絲」+ 小按鈕「不是 · 重選」

**Page D · 綁定成功**：
- 「綁定完成 ✓」
- 「你可以關閉此頁 · 繼續在 LINE 使用」
- 自動關閉 LIFF · 回到 bot 聊天視窗

**OTP 變體 Page C-2**（若走高保證）：
- 「請查收公司 email · 輸入 6 位數字碼」
- OTP 輸入框
- 「重寄」按鈕

### 7-quinque.5 Backend delta

**LIFF endpoint**：
```typescript
@Get("/liff/binding/init")
async liffInit(@Query("lineUserId") lineUserId: string, @Query("botId") botId: string) {
  // 驗 lineUserId 屬 bot 對應的 tenant
  const bot = await this.botRepo.getById(botId);

  // 檢查是否已綁定
  const existing = await this.bindingRepo.getByLineUserId(botId, lineUserId);
  if (existing) return { status: "already_bound", user: existing.userDisplayName };

  // 列未綁 users（tenant scoped）
  const unboundUsers = await this.userRepo.listUnbound(bot.tenantId);
  return { status: "ready", users: unboundUsers };
}

@Post("/liff/binding/complete")
async liffComplete(@Body() body: { lineUserId: string; userId: string; botId: string }) {
  // 驗 lineUserId 屬 bot 對應 tenant · userId 屬同 tenant · 未綁定
  // 綁定
  await this.bindingRepo.upsert({
    userId: body.userId,
    botId: body.botId,
    lineUserId: body.lineUserId,
    method: "liff_self_service",
    status: "active",
  });
  return { status: "success" };
}
```

**LINE bot follow event 擴**：
```typescript
async handleFollow(bot, event) {
  const liffUrl = `${process.env.LIFF_ENDPOINT_URL}?botId=${bot.botId}`;
  await this.lineApi.replyMessage(event.replyToken, [
    { type: "text", text: "歡迎！請點下方按鈕完成綁定" },
    {
      type: "template",
      altText: "完成綁定",
      template: {
        type: "buttons",
        text: "點按鈕開始",
        actions: [{ type: "uri", label: "開始綁定", uri: liffUrl }],
      },
    },
  ]);
}
```

### 7-quinque.6 Effort 估算

- Backend: 6-8 天
  - LIFF endpoint（init / complete）(3 天)
  - LIFF channel config + Provider 設定 (1 天)
  - Bot follow event 擴 (0.5 天)
  - Users list unbound endpoint + RLS (1 天)
  - OTP send/verify（若做變體）+1-2 天
  - Tests (1 天)
- Frontend: 5-6 天
  - LIFF web pages (4 頁 · responsive · LINE App 內顯) (4 天)
  - LIFF SDK integration (0.5 天)
  - OTP UI（若做變體）+1 天
- LIFF channel setup: 1 天
- 客戶端配合: 每客戶 0.3 天（Aiproot 建 users · 客戶方發 QR）

**合計 · 12-15 天工程 + 每客戶 0.3 天業助**
- 純 LIFF：10-13 天
- LIFF + OTP：12-15 天

### 7-quinque.7 Pro / Con

**Pro**：
- ✅ **Alice 全程在 LINE 內** · 完全不離開熟悉的 App
- ✅ **無需登入 aiproot 網頁**（Alice 藍領大痛點消除）
- ✅ **無需記密碼**（一次性密碼分發 · 首次改密都省）
- ✅ **無需打員工編號 + email**（從列表選 · 全點擊）
- ✅ **無需業助 approve**（LIFF UserId 自動驗證）
- ✅ **技術認證**（LIFF SDK 保證 UserId 屬持有人）
- ✅ **精美 UI**（LIFF 是網頁 · 不受 bot text 限制）
- ✅ **業助工作減半**（不需分發密碼 · 不需 approve · 只前置建 users + 追未綁）
- ✅ **客戶端負擔輕**（只需分發 bot QR · 不需分發密碼給員工）

**Con**：
- ⚠️ **需開 LIFF channel**（LINE Developer Console 一次性設定 · 半天）
- ⚠️ **員工列表隱私**：預設顯所有未綁員工 · Alice 看到同事名字 · 需限制到自己部門
- ⚠️ **Alice 可能誤選同事**（→ 加二次確認 or Email OTP）
- ⚠️ **未 LINE 化員工無法用**（藍領少見 · 但存在）
- ⚠️ **LIFF WebView 限制**（不同 LINE App 版本 · 相容性略麻煩）
- ⚠️ **依賴 LINE 服務**（跟方向 7 同）

### 7-quinque.8 Edge cases

| 場景 | 處理 |
|---|---|
| Alice 誤選同事 · 沒二次確認 | Bot 私訊「你已綁定為 X」· 若非本人聯繫業助撤銷 |
| Alice 誤選同事 · 有 OTP 保底 | OTP 寄到同事 email · Alice 收不到 · 無法完成 |
| 未 LINE 化員工 | 系統顯「請客戶方協助」· 業助手動綁（方向 2 fallback）|
| Alice 部門有 100 人 · 列表太長 | LIFF 頁加 search box · 打字過濾 |
| Alice UserId 已綁另一 user（換帳號）| LIFF 顯「你已綁定 X · 是否更換」· 需業助 approve |
| Alice 不在 users 表 | LIFF 顯「未在員工名單 · 聯繫公司資訊窗口」|
| LIFF channel 未 config | Bot follow event 回 fallback「請進網頁綁定」（方向 7）|
| LINE App 版本太舊 · LIFF 不支援 | 提示升級 or fallback 方向 7 |

### 7-quinque.9 準確性設計

**基礎 · 99.95%**（不含 OTP）：
- LIFF SDK 提供 UserId（技術認證）· 這部分 99.99% 準確
- Alice 選錯同事的機率 · 若列表限制到自己部門（5-10 人）· 誤選率 < 5%
- 加二次確認頁「你是品保部王愛麗絲嗎？」· 誤選率降到 < 1%
- 綁後 bot 私訊 + email 通知 · 冒名可被撤銷

**變體 · 99.99%**（加 Email OTP）：
- 誤選同事 → OTP 寄到同事 email · Alice 收不到 · 無法完成
- Alice 被冒名 → 需拿到 Alice 的 email 密碼 or Alice 手機 LINE · 兩個都是嚴重侵入
- 綁定完 audit trail 完整

### 7-quinque.10 vs 其他方向

| vs | 方向 7 (OAuth) | 方向 6 (Bot-Native) | 方向 8 (LIFF) |
|---|:-:|:-:|:-:|
| Alice 動作 | 6 | 2（含打字）| **3-5（全點擊）** |
| Alice 打字 | 密碼 + 密碼 | 編號 + email | **無 · 或 6 位 OTP** |
| Alice 需離開 LINE | ✅ | ❌ | ❌ |
| Alice 需登入 aiproot | ✅ | ❌ | ❌ |
| Alice 需記密碼 | ✅ | ❌ | ❌ |
| 業助 approve 每人 | ❌ | ✅ (30s) | ❌ |
| 綁定準確性 | 99.99% | 99.9% | 99.95%（或 99.99% 含 OTP）|
| 客戶端 email 分發 | ✅ 需 | ❌ | ❌（除非 OTP）|
| 開發 | 9-12 天 | 12-14 天 | **10-13 天** |

**方向 8 = 方向 7 的準確性 + 方向 6 的低摩擦**

### 7-quinque.11 隱私考量（員工列表）

員工列表顯示是**必然的隱私 tradeoff**：
- Alice 看到自己部門 5-10 同事名字（合理）
- Alice 不該看到全公司 100 人（過度）

**解法**：
- 列表**只顯 Alice 部門**（透過某種 metadata · e.g. LINE profile display_name pattern）
- 或加**姓氏 search box**（Alice 輸入「王」才顯姓王的員工）
- 或**兩階段**：Alice 先自選部門 · 再顯部門內未綁員工

實務上 · Alice 從自己部門 5-10 人中選 · 隱私損失可接受。

### 7-quinque.12 一次綁定 · 兩處識別（關鍵機制 · v0.6 補）

**用戶提問揭露的釐清點**（2026-07-22）：
> 「平台的訊息都是透過 LINE 群組去獲取 · 員工要怎麼正確的去綁定到自己的身份？」

**LINE 官方硬約束**：Bot **無法主動 push 給沒加好友的 user**（反 spam）。所以：
- ❌ 「Alice 在群組發訊 → 系統自動綁定」= 不可能
- ✅ 「Alice 加 bot 好友 → bot 私訊 LIFF → 綁定」= 唯一可行

**但綁定完成後 · 群組訊息也自動識別**：

LINE Messaging API 設計特性：**同一個 Alice · 在同一個 bot 底下 · 無論在哪個 chat（1-on-1 or 群組 A or 群組 B）· 她的 userId 都是同一個** `Uabc...123`。

流程：

```
                Alice 的 LINE
                UserId: Uabc123 (對此 bot 唯一)
                     │
     ┌───────────────┼───────────────┐
     ▼               ▼               ▼
  加 bot 好友     在群組 A 發訊    在群組 B 發訊
  ↓              ↓                 ↓
  綁定 flow      落 line_message   落 line_message
  ↓              sender=Uabc123    sender=Uabc123
  Uabc123 ↔        │                 │
  users.王愛麗絲   ▼                 ▼
                查 binding        查 binding
                = 王愛麗絲         = 王愛麗絲
```

**綁定完成後 · 系統對 3 種情境都能自動識別**：

| 情境 | Webhook event | 系統處理 |
|---|---|---|
| A · Alice 在「品保部群」發訊 | message · groupId + userId | line_message.sender_line_id = Uabc123 · 分析出 records/tasks · assignee 對到 users.王愛麗絲 |
| B · Alice 私訊 bot | message · 無 groupId + userId | 走個人日報 pipeline · 累到王愛麗絲 |
| C · Alice 在「業務群」也發訊 | message · groupId + userId | 同 A · 但 ticket 掛「業務部」· assignee 仍是王愛麗絲 |

**這是方向 8（也是方向 6、7）的關鍵優勢**：一次綁定投資 · 涵蓋全 bot 範圍。

### 7-quinque.13 未加 bot 好友的員工怎麼辦

現實：**5-20% 員工可能不加 bot 好友**（懶 / 手機不便 / 離職 / 不用 LINE）。

**這些員工的處理策略**：

1. **方向 3 · nudge 工具**（doc §6.9 · 可搭配）：
   - 系統掃 line_message · 發現 Uabc123 一直在群組發訊但無 binding
   - aiproot dashboard 提醒「這 UserId 常出現但沒綁 · 建議追」
   - 客戶方 HR 找人 · 提醒加 bot

2. **方向 2 · 手動填 fallback**（doc §5）：
   - Aiproot 業助拿 line_member.display_name 對員工名單
   - 手動綁「Uabc123 是王愛麗絲」
   - 用於堅決不加 bot 或無法加的員工

3. **標記「未參與個人日報」**：
   - 該員工的群組訊息仍被分析（會有 records / tickets）· 但 assignee 顯示為 `line_member.display_name` 而非 aiproot user
   - 主管在戰情室能看到 · 但無法對到 aiproot 帳號
   - 個人日報功能對這員工不可用

**推廣 3 步驟**（建議寫進客戶方 SOP）：
1. HR 內部宣告「請所有員工掃 QR 加公司 bot 為好友」
2. 加好友後 bot 自動推 LIFF · 90 秒完成
3. 未加 bot 的員工 · 系統標「未綁定」· HR / 業助定期 nudge

**實務綁定率預期**（100 員工 pilot · 依 nudge 力度）：
- 兩週內：60-80% 綁定
- 一個月內：85-95%
- 剩 5-15% · 走方向 2 fallback or 標「不參與個人日報」

---

## 8. 對比矩陣

> > **v0.6 更新（2026-07-22 用戶再次指正）**：
> - 用戶指出 v0.5 的方向 7 Alice 動作是**誤簡化**（實際 6 · 我算 2）· 業助時間也漏算（實際 7-8h · 我算 40min）
> - 加**方向 8 · LIFF**（Alice 全在 LINE 內 · 業助 zero per-employee approve）
> - 對比矩陣重新誠實 count 所有 stakeholder 真實動作

| 維度 | 方向 1 · 自服務 | 方向 2 · 手動 | 方向 4 · 混合 | 方向 5 · 高保證 | 方向 6 · Bot-Native | 方向 7 · LINE OAuth | **方向 8 · LIFF** |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **被綁員工 · 動作數** | 6 | 0 | 依路徑 | 6 + 等 approve | 2 (LINE 內輸入) | **6**（修正 · 非 2）| **3-5（全點擊或 OTP）** |
| **員工痛點** | 網頁登入 + 改密 | 無 | 混合 | 網頁登入 + 改密 + 等 | 打編號 + email | **網頁登入 + 改密**（藍領痛）| **無**（全在 LINE 內選擇）|
| **業助時間（100 員工含維護）** | 7-8h | **10-12h**（含維護）| 8-10h | 7-8h + 主管 50min | **6-7h**（含 approve）| **7-8h**（修正 · 含維護）| **3-4h**（前置 + 追未綁）|
| **主管負擔（100 員工）** | 0 | 0 | 中 | **50 分 approve** | 0 | 0 | 0 |
| **總體人員負擔** | 中 | 極高（業助扛）| 中-高 | 中-高 | 中 | 中 | **低** |
| **員工需登入 aiproot** | 需 | 不需 | 部分需 | 需 | 不需 | 需（1 次）| **不需** |
| **員工需記密碼** | 需 | 不需 | 部分 | 需 | 不需 | 需 | **不需** |
| **員工需手動輸入** | 網頁密碼 | 無 | 混合 | 網頁密碼 | 編號 + email 兩串 | 密碼 + 密碼 | **無 · 或 6 位 OTP** |
| **綁定率（第一週）** | 40-60% | 100% | 80-90% | 60-70% | 80%+ | **80%+** |
| **綁錯風險** | 低 | 中 | 中 | **極低** | 低 | **極低** |
| **準確性目標** | 99% | 99.5% | 99.5% | **99.99%+** | 99.9% | **99.99%** |
| **認證方式** | 密碼 | 業助人肉 | 混合 | 主管人肉 | 業助 + 雙欄位 | **LINE OAuth 技術認證** |
| **技術複雜度** | 中 | 低 | 極高 | 極高 | 中-高 | 中 |
| **Scale（10 家客戶）** | 極佳 | 差 | 佳 | 中 | 佳 | **極佳** |
| **Cold start** | 好 | 差 | 中 | 差 | 中 | **好** |
| **綁定完成率（第一月）** | 70-85% | 95%+ | 95%+ | 90%+ | 90%+ | 90%+ |
| **可 audit 深度** | 中 | 中 | 中 | **極高** | 高 | 高（OAuth log）|
| **未來擴展性（SSO / OIDC）** | 佳 | 中 | 佳 | 佳 | 中 | **極佳（OAuth 家族）** |
| **Pilot 期 fit** | 中 | 佳 | 過度 | 佳 | 極佳 | **極佳** |
| **高規產業 fit（醫療 / 金融）** | 中 | 中 | 中 | **極佳** | 佳 | **佳-極佳** |
| **依賴** | 網頁 UX | 完整名單 | 多路徑 | **主管網絡** | **客戶編號制度** | Email 分發 + LINE Login channel |
| **LINE 產品依賴** | Messaging API | Messaging API | Messaging API | Messaging API | Messaging API | **+ Login channel** |
| **需 Bot 認證** | 否 | 否 | 否 | 否 | 否 | 建議（加分不強制）|
| **開發工時** | 9 天 | 7 天 | 20-24 天 | 18-22 天 | 12-14 天 | **9-12 天** |
| **客戶端 onboarding 時間** | 每人 5 分鐘 | 名單 + aiproot 2h | 混合 | 名單 + 主管 + 2 週 | 名單 + 內部宣告 | 名單 + 一次性密碼 email |

**方向 3 保留為輔助**（見 §6.9）：
- 「未綁定偵測 · nudge 工具」· 3 天開發
- 搭配 1/2/4/5/6/7 任一綁定方向 · 提高綁定率

**方向 7 vs 方向 5/6 關鍵差異**：
- **7 vs 5**：準確平（99.99%）· 摩擦少 1 動作 + 免主管網絡 · 開發省 9-13 天 · 但 5 audit 更深
- **7 vs 6**：準確更高（99.99% vs 99.9%）· 不依賴客戶編號制度（vs 6 硬依賴）· 開發相近
- **7 需要**：LINE Login channel（獨立設定 · 一次性 · 認證加分不強制）

---

## 9. 業務 context 待釐清（用戶回答）

回答這些會幫我在批次 OQ 時給精確建議：

**Q · 台灣福祉員工能力**
- Q9-1 · 平均員工能自己用 email + password 登入網站嗎？
  - 100% 都能 → 方向 1 可行
  - 60-80% 能 → 方向 4 · 部分 self · 部分被動
  - < 60% 能 → 方向 2 主 · 少數 opt-in
- Q9-2 · 員工有公司 email 嗎（e.g. eric@twhomecare.com.tw）· 還是要用個人 gmail？
  - 有公司 email → 綁定 UX 順（顯 domain 讓員工好記）
  - 沒 → 需一次性 password（如同 tenant_provisioning 流程）· 摩擦大

**Q · Aiproot 業助容量**
- Q9-3 · aiproot 業助當前有幾人？
- Q9-4 · 每人每週能花幾小時做員工綁定？
- Q9-5 · 目標客戶數（1 年內）· 5 家 / 10 家 / 20 家 / 50 家？
  - < 10 家 → 方向 2 保底可用
  - 10-30 家 → 方向 4 phase A + B 較合適
  - > 30 家 → 必走方向 4 全套 · 或優先方向 1

**Q · 員工 LINE 名字習慣**
- Q9-6 · 抽 10 個台灣福祉員工的 LINE display_name 看看：
  - 多數是真名（王小明 / 李大華）→ 方向 3 可行
  - 多數是暱稱 / 顏文字（小明の手機 / 🌸小明🌸）→ 方向 3 對不上 · 不要選
- Q9-7 · 台灣福祉有沒有內部政策要求員工 LINE 用真名？
  - 有 → 方向 3 可靠
  - 沒 → 方向 3 fallback 到方向 2

**Q · 上線節奏**
- Q9-8 · 台灣福祉功能二上線時 · 是先幾個部門 pilot · 還是全公司一次上？
  - 先 pilot · 3-5 部門 · 20-30 員工 → 方向 2 保底綽綽有餘
  - 全公司 · 100+ 員工 → 需方向 4 至少 phase A + B

**Q · 未來擴展**
- Q9-9 · 未來會不會加 SSO / SAML / OIDC 給大客戶？
  - 會 → 方向 1 pattern 對未來友善
  - 不會 → 方向 2 也 OK

---

## 10. 風險分析（各方向獨立 · 加 P0/P1/P2）

### 10.1 共同風險

| # | 場景 | Sev | 緩解 |
|---|---|---|---|
| C1 | 綁定關係濫用 · Alice 綁到 Bob | P0 | Token TTL · UNIQUE constraint · audit log |
| C2 | LINE UserId 洩漏（e.g. 客戶端 URL 帶 UserId）| P1 | LINE UserId 是 Uxxx 亂數 · 洩漏無害於 aiproot · 但 aiproot 資料庫需 RLS |
| C3 | 員工離職 · binding 沒清 | P1 | Users soft delete 同時 cascade revoke · aiproot UI 定期 review |
| C4 | 跨 tenant 誤綁（顧問 A 在多 tenant 工作）| P1 | UNIQUE 是 (bot_id, line_user_id) · 允多 tenant · 但需 UI 明示 |

### 10.2 方向 1 專屬

| # | 場景 | Sev | 緩解 |
|---|---|---|---|
| D1-1 | 員工不會登入 | P0 · 綁定率殺手 | aiproot 業助教 · 但反而變方向 2 |
| D1-2 | Token 洩漏（貼在群裡）· 別人搶綁 | P1 | Token 短時效 · 私訊必須從對應 LINE UserId · 有安全屏障 |
| D1-3 | 員工不主動 · 個人日報 fail | P1 · 業務 kill | 主管催 · 或 fallback 方向 2 |

### 10.3 方向 2 專屬

| # | 場景 | Sev | 緩解 |
|---|---|---|---|
| D2-1 | aiproot 綁錯 | P0 · 信任崩 | 綁前 review 流程 · 綁後給客戶 audit 表 |
| D2-2 | 客戶不交名單 | P1 | 業務追 · 或走方向 1 混合 |
| D2-3 | 新員工 lag | P1 | 定期跑補 · 或允客戶 tenant_admin 自己新增（需 permission 開放）|

### 10.4 方向 3 專屬

| # | 場景 | Sev | 緩解 |
|---|---|---|---|
| D3-1 | 同名綁錯（王小明 A ↔ B）| P0 · 信任崩 | Confidence low · 強制人工 review · 不 auto-approve |
| D3-2 | Users 不存在 · propose 為空 | P1 | 需先方向 2 建 users · 依賴 |
| D3-3 | LINE 名改動 · 舊 binding stale | P1 | 週期 recheck · 顯 stale 提醒 |

### 10.5 方向 4 專屬

| # | 場景 | Sev | 緩解 |
|---|---|---|---|
| D4-1 | 3 路徑 conflict（同員工被兩 method 綁）| P0 | UNIQUE constraint 保底 · 但需 UI 清楚 |
| D4-2 | Aiproot 業助搞混 | P1 | Training doc + UI 標明「這 binding 是哪個 method」 |
| D4-3 | 過度工程 · pilot 客戶用不到 phase B/C | P2 | Phase-in · 分階段開 |

---

## 11. 遷移路徑（重要 · 選錯不是 fatal）

### 11.1 從方向 2 遷到方向 1 / 4

**若先做方向 2**（保底簡單）· 後想加方向 1 self-service：
- 現有 binding row 加欄 `method='aiproot_manual'` 標記歷史來源
- 新加 self_service pending 走同表 · method='self_service'
- 遷移**無需資料改動** · 只需新加 code path

**Cost of 換路徑**：0 (資料相容) + 開發方向 1 (9 天)

### 11.2 從方向 3 遷到方向 4

同樣相容 · 只需加 self_service / manual 兩路徑。

### 11.3 從方向 1 遷到方向 4

也相容。

### 11.4 從方向 2/4 遷到方向 5（加主管 approve 層）

若先做方向 2/4 · 之後升級到 5：
- 現有 binding 全 grandfather 為 `status='active'` 不動
- 新綁定走方向 5 流程（需 supervisor_user_id · users 表擴欄）
- 舊 binding 可選擇性 batch revalidate（bot push 通知 · 主管重審）
- **Cost of 升級**：users 表加 supervisor_user_id + 主管 approve UI (10-12 天 · 少於全新做)

### 11.4-B 從方向 2 遷到方向 6（加 bot-native 入口）

若先做方向 2 · 之後升級到 6：
- 現有 binding 全 grandfather 為 `status='active'` 不動
- 新綁定走方向 6 · webhook 加 follow / 1-on-1 handler · users 表加 employee_no
- 舊 binding **不需** re-verify（方向 2 aiproot 業助填的 · 已有信任基礎）
- **Cost of 升級**：webhook 擴 + users.employee_no + Aiproot approve UI · **8-10 天**（少於全新做 12-14 天）

### 11.4-C 從方向 6 升級到方向 5（若需最高保證）

- 新 binding 走方向 5 · users 表加 supervisor_user_id · 主管 approve 取代業助 approve
- 舊 binding 選擇性 batch revalidate
- **Cost of 升級**：8-10 天

### 11.4-D 從方向 2/6 升級到方向 7（若加 LINE Login）

- 需開 LINE Login channel + env config
- 新 binding 走 OAuth 流程 · 舊 binding 全 grandfather 為 active
- Users 表加 line_user_id 欄
- 前端加「用 LINE 登入」按鈕
- **Cost of 升級**：6-8 天（比全新做省 · 因 users / binding schema 已相容）

### 11.4-E 方向 7 降回方向 2（若 LINE Login channel 故障）

- Fallback 到方向 2 手動
- Binding 表 method 標記各自來源
- **Cost of 降級**：0 天（代碼路徑並存）

### 11.5 從方向 5 降回方向 2（若主管網絡不可用）

- Binding 表 status 從 `pending_supervisor_approval` 直接跳 `active`
- 忽略 supervisor 需求
- **Cost of 降級**：改邏輯 · 0 天資料遷移

### 11.6 結論

**方向間互相相容** · 選錯不 fatal。降低現在決策的心理負擔 · 可以先選最簡單的方向 2 快速 pilot · 之後升級到方向 4（scale）或方向 5（高保證）· 資料相容不會 rework。

---

## 12. 我的技術建議（供批次 OQ 參考）

> **v0.5 修正**：前版本用「員工端摩擦」為主指標 · 忽略業助也是員工。改用「總體人員負擔」重新排序 · 方向 2 從虛假第 1 掉到墊底。

**依「總體人員負擔」+ 準確性 + 開發工時綜合排名**：

| 排名 | 方向 | 總體負擔 | 準確 | 工時 | 適合情境 |
|:-:|---|:-:|:-:|:-:|---|
| 🥇 1 | **方向 8 · LIFF** | **低**（3-4h/100 人）| 99.95%（99.99% 含 OTP）| **10-13 天** | **藍領 / 傳產 · 首選** · Alice 完全不離 LINE |
| 🥈 2 | 方向 7 · LINE OAuth | 中（7-8h）| 99.99% | 9-12 天 | 白領產業 · 員工熟網頁登入 |
| 🥈 2 | 方向 6 · Bot-Native | 中（6-7h）| 99.9% | 12-14 天 | 純藍領 · 不會登入網頁 · 但有員工編號 |
| 🥉 4 | 方向 5 · 高保證 | 中-高 | 99.99%+ | 18-22 天 | 醫療 / 金融 / 政府 · 需主管 audit |
| 5 | 方向 4 · 混合 | 中-高 | 99.5% | 20-24 天 | 極大量客戶 · 覆蓋率必要 |
| 6 | 方向 1 · 自服務 | 中（7-8h）| 99% | 9 天 | 技術產業 · 員工都會用網頁 |
| ❌ | 方向 2 · 手動 | 極高（10-12h）| 99.5% | 7 天 | 只 1-2 家客戶 pilot |
| ➕ | 方向 3 · nudge | +3 天 | 不當綁定 | 3 天 | **搭配任一方向**提高綁定率 |

**方向 2 的真相**：
- 表面「員工零動作」看似完美 · 實際**業助扛 10-12 小時/100 員工**（含維護）
- 若 aiproot 有 3 家客戶各 100 員工 · 業助 30 小時 = 週工時 75% 全花在綁定 · scale 不了

**方向 7 v0.5 過度樂觀的修正**：
- v0.5 說 Alice 只 2 動作 → v0.6 承認實際 6 動作
- v0.5 說業助 40 分鐘 → v0.6 承認實際 7-8 小時（含維護：追未綁、密碼重置、換手機）
- 修正後 · 方向 7 從「無腦最佳」變「白領產業合適」

**互斥組合說明**：
- **方向 8（LIFF）是新的預設**：Alice 全在 LINE 內 · 技術認證 + 業助工作最少
- **方向 7 適合白領**：客戶員工都會用網頁登入 · 熟悉密碼管理
- **方向 6 適合傳產**：Alice 打字習慣（每天用 LINE）· 客戶有明確員工編號
- **方向 3 只作 nudge 輔助**（見 §6.9）· 可搭配任一綁定方向
- 方向 8 vs 方向 7：8 對藍領好（不需離開 LINE）· 7 對白領好（熟悉網頁）
- 方向 8 vs 方向 6：8 準確更高（技術認證 vs 人肉）· 且業助不需 per-employee approve
- 方向 5 適合醫療 / 金融 / 政府 · 需展主管 audit 責任鏈

**上下文提示**（不 lock · 依 §9 業務 context 答案對照）：
- 若客戶是**藍領工廠**（台灣福祉 · 鮮湧）· 員工每天用 LINE · 不熟網頁登入 → **方向 8（LIFF）**
- 若客戶是**白領辦公室**（律師 / 顧問 / 科技公司）· 員工熟網頁登入 → **方向 7 也行**
- 若客戶是**保險 / 醫療 / 政府** · 需展 audit → 方向 5
- **方向 3 nudge 幾乎所有情境都值得加**（3 天投資 · 提高綁定率）

---

## 13. 相關模組（哪些 module 依賴此設計）

| Module | 依賴強度 | 若此 module 拖延的影響 |
|---|---|---|
| `personal-daily-report`（M0-B）· 台灣福祉功能二 | **P0 硬依賴** | 完全動不了 |
| [[warroom-task-board]] OQ-WTB-3（employee role） | P1 · 選項依賴 | v1 走「主管代看」也可 · 不 block |
| 個人化通知（未來）| P1 · 硬依賴 | v1 沒此需求 · 可延 |
| 稽核追蹤深化（line_message.sender 對到 aiproot user）| P2 | 只影響 aiproot 內部視角 · 不 block 客戶 |

---

## 14. 開放問題（OQ-ELB-N）— 待批次 OQ 裁定

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-ELB-1** | 選哪個方向？ | A. 方向 1（自服務）<br>B. 方向 2（手動）<br>~~C. 方向 3（推導）~~ ⚠️ 降級（見 §6）<br>D. 方向 4 phase A only<br>E. 方向 4 phase A + B<br>F. 方向 4 全套<br>G. 方向 5（層層驗證高保證）<br>H. 方向 6（Bot-Native + 業助覆核）<br>I. 方向 7（LINE Login OAuth）<br>**J. 方向 8（LIFF Zero-Config）** ✅ **已裁定**<br>+ 可疊加 方向 3 nudge 工具（§6.9）| ✅ **裁定：J**（2026-07-22 用戶拍板）· 藍領傳產首選 · Zero-Config 業助最少 · 一次綁定兩處識別 |
| **OQ-ELB-2** | Users 表擴欄 vs 獨立 binding 表 | A. Users +2 欄（line_user_id, bound_at）· 簡單直接<br>B. 獨立 user_line_binding 表 · 支援 audit history | **B** — audit history 值得（誰綁誰、method、時間、revoke 歷史）· A/B 資料量差異不大 · 但 A 也可（一 tenant 一 bot · 沒 multi-binding 需求）· 二選一都合理 |
| **OQ-ELB-3** | 若走方向 3 · Match confidence 閾值 | A. 只 high 自動 approve · medium/low review<br>B. High + medium 自動<br>C. 全部人工 review | **A** — 保守 · 但可調 |
| **OQ-ELB-4** | 綁定失敗（token 過期 / bot 回覆） · Bot 是否主動回訊息 | A. Bot 一律 reply（reply token · 免費）<br>B. Bot 不 reply · aiproot UI 顯錯給員工<br>C. Bot 只在成功時 reply · 失敗靜默 | **A** — reply token 免費 · UX 順 · 不占 push quota |
| **OQ-ELB-5** | 員工離職 · binding 處理 | A. Users soft delete · cascade revoke<br>B. 保留 binding 記錄 · 標 revoked · 供 audit | **B** — audit 保 · 資料不消失 |
| **OQ-ELB-6** | 綁定 UI · aiproot 端誰能操作 | A. 只 aiproot_admin<br>B. aiproot_admin + consultant<br>C. B + tenant_admin | **A** — 高權限操作 · 客戶不碰 |
| **OQ-ELB-7** | 前置：tenant 員工 users 表誰建 | A. Aiproot 業助 wizard 建<br>B. Tenant_admin 自服務建（現在部門/成員頁）<br>C. 兩者都可 | **C** — 客戶主導 · aiproot 提供 wizard 做 bootstrap |

---

## 15. 失效場景反思（FMEA · R17 收尾必填）

> Pre-mortem 心態 · 假設系統已壞 · 反推每條路徑會怎麼壞。
> P0 = 未緩解不得上 prod（資料錯 / 安全洞 / 全 tenant 掛）
> P1 = 已知殘留 · 需列治本方向
> P2 = 可忍 · 記錄不修
>
> 逐路徑（每個入口 / 外呼 / 狀態轉換 / 並發點 / 部署順序）走一遍。

### 15.1 LIFF entry · `GET /binding/liff/prefill`

| 失效模式 | 影響 | 嚴重度 | 緩解狀態 |
|---|---|---|---|
| 惡意帶假 `lineUserId` | 攻擊者查得別人 pre-fill · 拿 displayName / 部門推斷 | **P0** | ✅ **LIFF SDK 保證** · lineUserId 由 LINE 平台簽發 · 前端不能偽造 · 惡意者只能查自己 |
| 惡意帶假 `botId` | 400 (bot 不存在) or 讀到別 tenant line_member 資料 | P1 | ✅ Query 用 `${botId}::uuid` cast · 非合法 UUID 直接 SQL error（500 快擋）· 合法 botId 只查該 bot 的 line_member (RLS 走 aiproot_admin · 但範圍限 bot_id) · pre-fill 只回 displayName/pictureUrl · 不 leak 敏感 |
| line_member 沒該 UserId (Alice 從未在群組發言) | prefill 回空 candidateGroups · Alice 無法選群 | P1 | ✅ v0.6.3 已改：LIFF UI 顯「未偵測到你的群組活動 · 請聯繫業助手動設部門」· 走 aiproot_manual fallback |
| line_member fetch_error 為某值 (LINE API 失敗) | displayName null | P2 | ✅ UI fallback「未偵測到姓名 · 請手動輸入」 |
| Timing attack · 大量嘗試 lineUserId 探測 | 隱私 leak | P1 | ⚠️ 殘留 · endpoint 無 rate limit · 建議：Fastify + `@fastify/rate-limit` 限每 IP 60 req/min |
| DB down / RLS misconfig → 500 | LIFF UI 顯錯 · Alice 無法綁 | P1 | ✅ Toast 顯錯 · Alice 手動點「重試」 · 治本：加 Sentry alert |

### 15.2 LIFF entry · `POST /binding/liff/complete`

| 失效模式 | 影響 | 嚴重度 | 緩解狀態 |
|---|---|---|---|
| Alice 快速雙點送出 → 兩個 request 併行 | 兩個 INSERT users + binding · race | **P0** | ✅ `user_line_binding UNIQUE (bot_id, line_user_id)` · 第 2 個 INSERT ON CONFLICT DO UPDATE 反活復 · **不會**建兩個 users（第 2 個 INSERT users 也 unique on email 佔位）· 已測 |
| Alice 點兩次不同資訊送出 · 第 2 個先到 | 綁定用第 1 個資訊 · Alice 看到第 2 個顯示但 DB 是第 1 個 | P1 | ⚠️ Repository create ON CONFLICT DO UPDATE 會用**後到的** args 覆蓋 metadata + boundBy · display_name 也可能不一致 · 治本：LIFF 頁 loading state 阻雙點 (已加 disabled=true) |
| 惡意帶假 primaryGroupId (別 tenant 的) | 綁到別 tenant 的 department | **P0** | ✅ SQL WHERE 加 `lg.bot_id = args.botId` · 別 tenant 的 group 對不到 · 查回 null |
| Alice 用假 lineUserId (若 LIFF SDK 被繞) | 拿別人 UserId 綁到自己帳號 · 冒充 | **P0** | ✅ LIFF SDK 服務端簽發 · 前端無法偽造 · 惡意方**沒 access token** 無法呼叫 API |
| 綁定完成 · 但 Bot access token 失效 · reply「✓ 綁定成功」失敗 | Alice 不知綁成功 · 誤試第二次 | P1 | ⚠️ 殘留 · webhook reply 失敗只 log warn · Alice 可能重打 API → ON CONFLICT DO UPDATE 復活（無害）· 治本：LIFF UI 直接顯「綁定成功」不依賴 bot 訊息 (已如此) |
| DB down · users INSERT 失敗 | 500 · Alice 頁面卡住 | P1 | ✅ 頁面顯 error toast + 「重試」按鈕 |

### 15.3 Webhook entry · follow event (Alice 加好友)

| 失效模式 | 影響 | 嚴重度 | 緩解狀態 |
|---|---|---|---|
| LIFF_URL env 未設 | Bot 不推綁定連結 · Alice 加好友後靜默 | **P0** | ✅ Code check `if (liffUrl && event.replyToken)` · 未設不 crash · 但 Alice 沒訊息 · 治本：Pre-prod checklist 強制驗 LIFF_URL 設 |
| Reply token 過期 (加好友後 > 60s 才觸發推) | reply 失敗 · Alice 沒訊息 | P1 | ✅ reply 失敗只 log · 治本：webhook Q latency < 60s (現況 < 1s) |
| Alice 加好友 · webhook 剛好 down | Alice 沒收綁定連結 | P1 | ⚠️ 殘留 · LINE 不會 retry follow event · 治本：Alice 私訊 bot「hi」也會觸發推 LIFF (§7-quinque.13 nudge) |
| Bot 被 unblock/block 循環 · 觸發多次 follow | 多次推綁定訊息 (擾民) | P2 | ✅ 現況可忍 · 每次 follow 都推 · 若擾民再加 dedup |

### 15.4 Webhook entry · 1-on-1 message (personal daily report 素材)

| 失效模式 | 影響 | 嚴重度 | 緩解狀態 |
|---|---|---|---|
| Alice 未綁定就私訊 · bot 沒推 hint | Alice 沒察覺該綁 | P1 | ✅ `resolveUserByLineUserId` 回 null · webhook reply「請先完成綁定 · <LIFF>」 |
| Alice 撤銷後私訊 | 反查 null · 資料不落庫 | ✅ 預期行為 | ✅ 對齊 §5.5 revoke 語意 |
| resolveUserByLineUserId 高頻 · DB 慢查 | webhook latency 拉長 | P1 | ✅ 有 `ix_user_line_binding_lookup` (bot_id, line_user_id) partial index on status='active' |
| Personal message group_id 佔位符 `__personal__${userId}` | line_message.group_id 存假值 · 未來 warroom 查詢誤中 | P2 | ✅ warroom 查詢 filter `chat_context='group'` (已 index) · personal 分開 |

### 15.5 Aiproot audit UI · `POST /binding/aiproot/revoke`

| 失效模式 | 影響 | 嚴重度 | 緩解狀態 |
|---|---|---|---|
| 非 aiproot_admin/consultant 呼叫 | 越權撤銷 | **P0** | ✅ `@Roles("aiproot_admin")` guard · 已測 (permission-engine.test.ts) |
| 錯撤有效 binding | Alice 綁定被撤 · 無法收訊 | P1 | ⚠️ 殘留 · Alice 需重走 LIFF flow · 治本：UI ConfirmDialog + audit log (已加) |
| 撤銷後 Alice 資料歸屬混亂 | 舊 group 訊息仍有 sender_user_id · 新綁後別 user | P1 | ✅ user_line_binding UNIQUE (bot_id, line_user_id) · reactivate 同 binding_id · users.user_id 不變 · 舊訊息仍對到同 user |

### 15.6 Nudge cron · 每日 09:00 台北

| 失效模式 | 影響 | 嚴重度 | 緩解狀態 |
|---|---|---|---|
| Cron 沒設 timezone 跑錯時間 | UX 差 (半夜 log) 但不影響資料 | P2 | ✅ 已加 `{ timeZone: "Asia/Taipei" }` |
| findUnboundActiveUsers 慢查 | Cron 拖久 | P1 | ✅ line_message 有 (tenant_id, sender_line_id, sent_at) 潛在 index · lookback 7 天量小 |
| 全 tenant 100 家 · 掃 100 次 → 累積 30s+ | Cron block 其他 job | P2 | ✅ 現況 tenant 2 家 · 不會炸 · 治本：加 concurrency limit + partition |
| Nudge log 未落 audit_log | 業助不知歷史 | P2 | ⚠️ 殘留 · 只 Logger.log · 治本：加 audit_log(action='nudge_scan') |

### 15.7 部署順序（DB migration → backend → frontend → LIFF）

| 失效模式 | 影響 | 嚴重度 | 緩解狀態 |
|---|---|---|---|
| SQL 0016 沒跑 · backend 已升級 | webhook 打 bindingService → column 不存在 → 500 | **P0** | ✅ Pre-prod SOP：先跑 SQL · 才 push code · 已寫進 `docs/sop/liff-setup.md` §8.1 |
| Backend 升 · Web 沒升（LIFF ID 沒注入） | LIFF 開啟 initFailed | **P0** | ✅ Web + Backend 同時 push · Render 自動並行 redeploy · 已測 (2026-07-22 push) |
| Migration 0016 rollback (down.sql) | line_message 兩欄消失 · 舊資料 sender_user_id 遺失 | P1 | ✅ down.sql 只 DROP · 不 drop CHECK constraint · 資料還在(欄位刪) · rollback 場景稀有 |
| Render env `LIFF_URL` 沒設 · backend redeploy | Bot 加好友後不推 LIFF | **P0** | ✅ 已於 pre-prod SOP §7.1 列必設 env · Backend startup 建議 log warn 若 env 缺（治本 TODO） |

### 15.8 並發 / 邊界 case

| 失效模式 | 影響 | 嚴重度 | 緩解狀態 |
|---|---|---|---|
| 同 Alice 用兩支手機（兩個 LINE 帳號 · 同名字）點同綁定連結 | 兩 lineUserId 都綁到「Alice」users 記錄 (兩個 users) | P1 | ⚠️ 殘留 · Alice 姓名同但 user_id 不同 · UI 顯兩個 · 業助 audit 頁可撤 · 治本：display_name + department 相同時 warn |
| Alice 綁 · 業助手動撤 · Alice 再綁 · 業助又撤 · ...  | user_line_binding row 反覆 status 切 | P2 | ✅ audit history 用 revoked_at + revoked_by · 都保留 |
| 100+ 員工同時綁 (新客戶 kickoff) | DB 打爆 · Render free tier connection 上限 | P1 | ⚠️ 殘留 · Fastify default 200 concurrent · pg pool 20 · **實測需驗** · 治本：LIFF 頁加 queue + retry with backoff |
| Alice 綁 · 立即撤 · 立即綁 (race < 100ms) | user_line_binding 3 個 UPDATE · 最後 status | P2 | ✅ ON CONFLICT DO UPDATE 冪等 · 最後 state 是最後 UPDATE · 已測 |

### 15.9 pre-existing 問題（不在本 module scope 修 · 記錄）

- **p_users RLS 不允 system role**：webhook 觸發的 INSERT users 需走 `withTenant + tenant_admin` 兩階段 · 已在 employee-binding.service.ts 處理 · 建議：未來 migration 加 'system' 到 p_users (對齊 0011+ pattern)
- **p_departments RLS 不允 aiproot_admin**：僅 tenant match · 治本：同上加 aiproot_admin
- **auth.test.ts 預存壞 test**：不歸此 module · 應獨立 fix

### 15.10 P0 清單 · 上 prod 前必檢

- [x] LIFF SDK 提供的 lineUserId 為 LINE 平台簽發（技術認證） — LINE docs 已 confirm
- [x] user_line_binding UNIQUE (bot_id, line_user_id) — SQL constraint enforced
- [x] Aiproot audit endpoint 有 @Roles guard — permission-engine.test.ts 過
- [x] SQL 0016 migration 已跑 prod — user 2026-07-22 手動 confirm
- [x] LIFF_URL env 已設 — pre-prod checklist §7.1 手動確認
- [x] Web + Backend 同時 redeploy 完 — 2026-07-22 monitor 通過
- [x] LIFF ID 已注入 binding.html — commit 4dbef72

**結論：P0 全部 ✅ · 可上 prod。P1 殘留 6 項 · 都有治本方向、可容忍。**

---

## 16. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-22 | v0.1 | 初版 DESIGN STUDY · 4 方向徹底分析 · 對比矩陣 · 業務 context 待釐清 · OQ-ELB-1..7 · 遷移路徑保底彈性 | Claude Code |
| 2026-07-22 | v0.2 | 加方向 5 「層層驗證高保證（99.99%+）」· 3 個獨立來源 confirm + 時間軸保護 · 對比矩陣加 6 個新維度 · §12 建議加高保證情境 · §11 加遷移路徑（方向 2/4 → 5 升級 · 5 → 2 降級）· OQ-ELB-1 加選項 G · 保留中立 | Claude Code |
| 2026-07-22 | v0.3 | 加方向 6「Bot-Native + 業助覆核（99.9% · 員工摩擦最低）」· 方向 3 降級為「未綁定偵測工具」· 補 §6.9 nudge 用法 · §7-ter 詳述方向 6 · 對比矩陣改為 5 方向並列 · 方向 3 保留但明確不當綁定 · §11 加方向 2→6 / 6→5 遷移路徑 · §12 建議加「員工摩擦最低+高準確」情境 · OQ-ELB-1 加選項 H · 保留中立 · 感謝用戶對 LINE API 限制的正確記憶 | Claude Code + 用戶 discussion |
| 2026-07-22 | v0.4 | 加方向 7「LINE Login OAuth 自動綁定（99.99% + 開發最少 + 技術認證非人肉）」· §7-quater 詳述（含 LINE Login channel 設定 · OAuth callback · 認證帳號考量）· 對比矩陣加方向 7 欄位 · 新增「認證方式」「LINE 產品依賴」「需 Bot 認證」3 維度 · §11 加方向 2/6 → 7 升級路徑 + 方向 7 → 2 降級 · §12 建議加「高準確 + 低摩擦 + 最少工時 + 未來 SSO」情境 · OQ-ELB-1 加選項 I · 保留中立 · 感謝用戶對 LINE 認證與 Login 的洞察 | Claude Code + 用戶 discussion |
| 2026-07-22 | v0.5 | **Framing 修正**（用戶指正）：前版本用「員工端摩擦」為主指標 · 但業助本身就是員工 · 這 framing 讓方向 2 假象排第 1（業助扛所有工作但沒 count）· 改用「總體人員負擔」= 被綁員工 + 業助 + 主管 friction 加總 · 對比矩陣重寫（拆 3 個 stakeholder + 總體行）· 方向 2 從虛假第 1 掉到墊底（100 員工要業助 5 小時 · 3 家客戶佔業助週工時 37%）· 方向 7 成為真正的最佳解 · §12 建議大幅重寫 · 感謝用戶識別此 framing 盲區 | Claude Code + 用戶指正 |
| 2026-07-22 | v0.6 | **方向 7 過度樂觀修正 + 方向 8 LIFF 補入**（用戶再次指正）：v0.5 說方向 7 Alice 只 2 動作是**誤簡化**（實際 6 · 含網頁登入 + 首次改密）· 業助時間也漏算（實際 7-8h 含維護 · 我算 40min）· 加方向 8「LIFF + 員工列表選擇」（Alice 全在 LINE 內 · 3-5 動作 · 業助不需 per-employee approve · 準確 99.95% or 99.99% 含 OTP · 工時 10-13 天）· 修正排名：**方向 8 = 藍領傳產首選** · 方向 7 = 白領 · 方向 6 = 有員工編號的傳產 · 感謝用戶識別 Alice 真實摩擦 | Claude Code + 用戶指正 |
| 2026-07-22 | v0.6.1 | 用戶提問揭露關鍵釐清：「平台訊息透過群組獲取 · 員工如何綁到自己身份」· 補 §7-quinque.12「一次綁定 · 兩處識別」機制（LINE UserId 對同 bot 唯一 · 綁定完成後 · 群組訊息也自動識別 · 3 種情境：群組 A / 私訊 / 群組 B 都對到 users.王愛麗絲）· 補 §7-quinque.13「未加 bot 好友員工處理」（方向 3 nudge + 方向 2 fallback · 5-20% 員工可能不加 · 推廣 3 步驟 SOP）· 感謝用戶識別此關鍵前提 | Claude Code + 用戶提問 |
| 2026-07-22 | v0.6.2 | 用戶指正「跨 tenant UserId 不同」的過度工程：**一家租戶只配一個 LINE bot** · Alice 只在一家公司當員工 · 沒有 multi-binding 需求 · OQ-ELB-2 從「B 明顯優」放寬為「A/B 都合理」· 移除跨顧問等 edge case 假設 · design 保持簡單（audit history 仍值得 · 但別為想像的 multi-tenant 需求增複雜度）| Claude Code + 用戶指正 |
| 2026-07-22 | v0.6.3 | **Zero-Config 修正**（用戶指正）：方向 8 STAGE 0「CSV 批次匯入 100 員工」是過度工程 · line_member 已由 webhook 自動收集所有活躍員工 UserId + display_name · LIFF 可直接 pre-fill · 業助不需 CSV 匯入 · 不需分發密碼 · **業助時間從 3-4h/100 員工降到 < 1h**（只前置 tenant + 部門 + group_owner 5-10 人 · 其他員工全自服務）· Alice 動作從 3-5 降到 2（加好友 + 點確認）· 需求文件的「員工在群發訊時系統就記」是這個機制 · mockup 已更新（畫面 1-B 從「選員工列表」改為「自動 pre-fill 確認」）| Claude Code + 用戶指正 |
| 2026-07-22 | v0.6.4 | **UX + 認證維度修正**（用戶指正）：<br>1) 部門標籤 → LINE 群組名稱：Alice 熟「福祉—品保部」群名（她每天在裡面）· 不熟「品保部」aiproot 抽象名 · UI 改顯 LINE 群名 · 系統靜默透過 line_group.department_id 對應到 department（一步隱藏在後台）· mockup 畫面 1-B/1-C 更新<br>2) 移除 Email OTP 變體：Zero-Config 下 Alice 不從列表選同事（沒選錯風險）· LINE UserId 已是**技術認證**（LINE 服務端保證）· 加 email OTP 是同維度重複認證 · 無實質效益 · mockup 相關區段刪 · 綁定準確率直接 99.99%（不需 OTP 保底）| Claude Code + 用戶指正 |
| 2026-07-22 | **v1.0** | ✅ **APPROVED**（用戶拍板）· OQ-ELB-1 裁定 **J · 方向 8 LIFF Zero-Config** · 6 次歷代修正後定案 · 狀態從 DESIGN STUDY 升為 APPROVED · 進 M1 · 剩餘 OQ-ELB-2..7 (資料模型 + 實作細節) 待批次 OQ 裁定 | Claude Code + 用戶拍板 |
| 2026-07-22 | **v1.0.1** | ✅ **批次 OQ 全採建議**（用戶拍板）· OQ-ELB-2..7 全裁定：<br>· ELB-2 → B (獨立 user_line_binding 表 · audit history 好)<br>· ELB-4 → A (Bot 主動 reply · reply token 免費)<br>· ELB-5 → B (保 revoked 記錄 · audit)<br>· ELB-6 → A (只 aiproot_admin 操作)<br>· ELB-7 → C (客戶主導 + aiproot wizard 都可)<br>ELB-3 已在 v0.3 降級為 nudge 工具 · skip | Claude Code + 用戶拍板 |
| 2026-07-23 | **v1.1** | ✅ **M5 收尾 SHIPPED** · 完成：<br>· `server/test/employee-binding.test.ts` 8 個 unit/integration test 全綠<br>· §15 FMEA 失效場景反思 · 覆蓋 4 個 entry 路徑 + 部署順序 + 並發 · P0 全緩解 · P1 殘留 6 項均有治本方向<br>· service layer RLS 修正：webhook 觸發的路徑改走 `withTenant + aiproot_admin` (user_line_binding EXISTS→users 子查詢會撞 users RLS)<br>· `docs/sop/liff-setup.md` SOP 已寫（含 troubleshooting）· 未來新租戶 30 分鐘可接入 | Claude Code + 用戶 |
