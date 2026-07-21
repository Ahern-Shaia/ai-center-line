# line-ingest.md — [P1/P2] LINE Bot 註冊 & Group Registry 設計文件

> ✅ **狀態：APPROVED — OQ-LI-1..4 明確裁定 · OQ-LI-5..8 採建議（用戶保留反對權）· 進 M1（2026-07-21）**
>
> 把「把 LINE 官方帳號 bot 加進工廠群組 → 拿到 groupId → 對應 tenant / 部門 → 開始收訊息」變成 SaaS 平台的一級 feature。首期解決台灣福祉 9 群 groupId 取得問題；同時把資料模型 / webhook 路由 / UI 骨架做正，讓下一位客戶（鮮勇或未來）**zero-friction 上線**（不動 env、不重啟）。
>
> 這是 EEA 三層架構「通訊接頭層」的第一個 tenant-facing feature。屬**方案 C · 分階段做**：這輪把資料模型 + webhook + 極簡 admin UI 做完（3–5 天），後續 iterate 加分析 policy / 主檔對應 / 群主確認迴圈。
>
> 作者：Claude Code（草擬）｜版本：v0.1（2026-07-21）

---

## 1. 目標與範圍

### 1.1 目標

1. **多租戶 LINE Bot 註冊**：aiproot_admin 在後台可新增 bot（Channel Access Token + Channel Secret），資料以 pgcrypto AES-256 加密存 Postgres。
2. **groupId 自動偵測**：Bot 加入群、或群內任何 event（訊息、成員進出）觸發 webhook → 系統自動 upsert `line_group` 表，UI 上顯示。**零 env 動作、零重啟**。
3. **群組分派部門**：tenant_admin 進 bot 詳情頁，把 groupId 分派給對應 department（改裝報工群 → 改裝部；沐浴車保養群 → 保養部...）。
4. **首客可用**：**台灣福祉 9 群 groupId 全部取得 + 部門對應 + UI 顯示**，作為對話分析上游輸入。

### 1.2 對應現況 / 訴求

| 子題 | 訴求 | 對應點 |
|---|---|---|
| 台灣福祉 9 群 | 客戶 IT 只提供 bot 給群主自加，不再介入 → 我方要「聽」到 groupId | §5 資料流 · §6 UI 詳情頁 |
| SaaS 上線體驗 | 下一客戶要 zero-friction · 不改 env、不動 code | §3 資料模型 · §7 UI 骨架 |
| EEA 通訊接頭層 | 產品線架構 · 通訊層要能 host 多客戶多 bot | 全篇 |

### 1.3 不做的事（Phase 1 · 防 scope creep）

- ❌ **不做訊息內容儲存 / 話題邊界偵測 / AI 分析觸發** — 這一輪只到「拿 groupId + 分派 department」為止；訊息內容 ingest 是 Phase 2 module。
- ❌ **不做群主確認迴圈 / Flex Message push** — Phase 3 module。
- ❌ **不整合 notify 模組現有 env-based 設定** — notify 保持不動；新的 line_bot 表為新資產、獨立管理。**未來合併** = Phase 2 決策點。
- ❌ **不支援客戶自己廣的 bot（token 上傳）** — OQ-LI-1 已裁定 · 只允許 aiproot 統一廣。
- ❌ **不支援共享 bot 跨 tenant** — OQ-LI-2 已裁定 · One Bot = One Tenant。
- ❌ **不做 tenant_admin 自助新增 bot** — OQ-LI-3 已裁定 · 只 aiproot_admin。
- ❌ **不做媒體檔即收即存** — 只 log event metadata，不下載 [照片] [影片] content URL。Phase 2 補（R13 適用時再上）。

---

## 2. 上游 / 既有現況走查

| 元件 | 現況 | Gap |
|---|---|---|
| LINE Channel（aiproot 廣的） | ✅ 已存在（notify 模組用中）· `LINE_CHANNEL_ACCESS_TOKEN` 在 env | 需開啟 webhook + 拿 Channel Secret |
| Fastify raw body | ⚠️ 未確認 · webhook 簽章驗證需 raw body | M1 確認 · 若沒開要 patch |
| pgcrypto | ✅ 已裝（llm-config migration 0007）· AES-256 pattern 可複用 | 直接抄 pattern |
| Departments 表 | ✅ 已有（tenant_admin 部門管理頁） | line_group.department_id FK 對到 |
| Audit log | ✅ 已有 pattern | Bot / Group 寫入操作要接進去 |
| Tenant / User / Roles | ✅ RLS + role guard 已在 | 直接套 |

---

## 3. 資料模型

### 3.1 新表

```sql
-- Migration 0008_line_bot_registry.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE line_bot (
  bot_id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  name                      text NOT NULL,                          -- 顯示名稱 e.g. "台灣福祉 AI 客服"
  channel_id                text NOT NULL,                          -- LINE channel ID · webhook payload 的 destination
  channel_secret_enc        bytea NOT NULL,                         -- pgcrypto AES-256
  channel_access_token_enc  bytea NOT NULL,                         -- pgcrypto AES-256
  status                    text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  webhook_verified_at       timestamptz,                            -- 首次成功驗簽時間
  created_by                uuid REFERENCES users(user_id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_line_bot_channel_id ON line_bot (channel_id);   -- destination lookup 用
CREATE INDEX idx_line_bot_tenant ON line_bot (tenant_id);

CREATE TABLE line_group (
  group_registry_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id             uuid NOT NULL REFERENCES line_bot(bot_id) ON DELETE CASCADE,
  group_id           text NOT NULL,                                 -- LINE groupId (Cxxx...)
  display_name       text,                                          -- 從 GET /v2/bot/group/{groupId}/summary 拉
  department_id      uuid REFERENCES departments(department_id),    -- 可 null (未分派)
  analyze_enabled    boolean NOT NULL DEFAULT false,                -- Phase 2 用 · Phase 1 只儲存
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_event_at      timestamptz NOT NULL DEFAULT now(),
  event_count        integer NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'left')),
  last_event_raw     jsonb                                          -- 最新 event · debug 用
);
CREATE UNIQUE INDEX idx_line_group_bot_gid ON line_group (bot_id, group_id);
CREATE INDEX idx_line_group_department ON line_group (department_id);
```

**RLS**：
- `line_bot`：SELECT / UPDATE / DELETE 依 `tenant_id = current_setting('app.current_tenant')::uuid`
- `line_group`：SELECT / UPDATE 依 `EXISTS (line_bot WHERE bot_id = line_group.bot_id AND tenant_id = current_tenant)`
- **Webhook endpoint 用 owner 角色繞 RLS**（無 session · 靠 destination 找 bot）

### 3.2 down migration

```sql
DROP TABLE line_group;
DROP TABLE line_bot;
```

---

## 4. API endpoints

| Method | Path | 權限 | 用途 |
|---|---|---|---|
| POST | `/api/line/webhook` | public + HMAC 驗簽 | 收 LINE event · 一律 200 |
| GET  | `/api/line-bots` | tenant_admin (own) · aiproot_admin (all) | 列表 |
| GET  | `/api/line-bots/:id` | 同上 | 詳情（含 groups） |
| POST | `/api/line-bots` | aiproot_admin only | 新增（傳 name / channel_id / channel_secret / access_token） |
| PATCH | `/api/line-bots/:id` | aiproot_admin only | 編輯 name / status |
| DELETE | `/api/line-bots/:id` | aiproot_admin only | 停用（soft delete = status='disabled'） |
| GET  | `/api/line-bots/:id/groups` | tenant_admin (own) · aiproot_admin | 該 bot 所有 groups |
| PATCH | `/api/line-groups/:id` | tenant_admin | 分派 department_id / 更新 display_name |
| POST | `/api/line-bots/:id/probe-name/:groupId` | tenant_admin | 手動觸發 LINE API 拉群 name |

**Response schema**：
- `line-bots` list 回 `{ bots: [{ botId, name, channelIdMasked: "Cxxx...***xxx", tenantId, status, webhookVerifiedAt, groupCount, createdAt }] }`
- `line-bots/:id` 回 `{ bot: {...}, groups: [{ groupRegistryId, groupId, displayName, departmentId, departmentName, analyzeEnabled, firstSeenAt, lastEventAt, eventCount, status }] }`
- Access token / secret **永不 return plaintext** · UI 只顯示遮罩

---

## 5. 資料流

### 5.1 註冊新 bot（aiproot_admin）

```
aiproot_admin 在 /line-bots 點「新增」
  ↓
填 name · channel_id · channel_secret · access_token
  ↓ POST /api/line-bots
Backend: 加密後寫 line_bot 表 · 產 bot_id
  ↓ audit log
UI: 跳到 /line-bots/:id 詳情頁 · 顯示 webhook URL
     (https://<host>/api/line/webhook)
  ↓
aiproot_admin 到 LINE Developer Console
   → 貼 webhook URL · 開 Use webhook = ON
```

### 5.2 群加入偵測（tenant_admin）

```
客戶群主把 bot 加進「改裝報工群」
  ↓ LINE push join event（destination = channel_id）
POST /api/line/webhook
  ↓
Backend:
  1. 驗簽（HMAC-SHA256(rawBody, channel_secret)）
  2. 依 destination 找 bot
  3. 對每個 event · 若 source.groupId 存在
     · upsert line_group (bot_id, group_id) 
     · event_count++ · last_event_at = event.timestamp
  4. 若是 join event · trigger 背景 job 拉 group display_name
     (GET /v2/bot/group/{groupId}/summary)
  5. Return 200 (< 500ms)
  ↓
tenant_admin 進 /line-bots/:id 詳情頁
  ↓
看到新群出現 · 分派 department
```

### 5.3 idempotency

- LINE at-least-once delivery · 同一 event 可能重送
- Upsert 語意天然 idempotent（同 groupId 不會建重複 row）
- `event_count++` 對 duplicate event 是問題 · 用 `(destination, event_timestamp, event_type, source_id)` composite 判重（M1 決 · 若不做 duplicate count 錯少量無傷大雅）

---

## 6. 前端 UI

### 6.1 Sidebar 新增

Shell.tsx `NAV` 加：
```
{
  group: "通訊接頭層",   // 新群組 · 屬 aiproot / tenant_admin 共用
  items: [
    { key: "line-bots", label: "LINE 機器人", ic: iconChat, done: true },
  ],
},
```

顯示規則：
- aiproot_admin · consultant · tenant_admin → 看得到
- group_owner → 看不到

### 6.2 主頁佈局：Master-Detail Split（2026-07-21 對話裁定）

**URL state**：
- `/line-bots` → 未選 · 右 pane 顯示 empty state
- `/line-bots/:botId` → 選中 · 右 pane 顯示該 bot detail
- 支援 deep link · bookmark / share URL 可 restore state

**佈局**：
- 左 30% · Bot 列表（compact）· scroll 獨立
- 右 70% · 選中 bot 的詳情 · scroll 獨立
- 頂部 sticky header · title + 「+ 新增機器人」按鈕（aiproot_admin only）

```
┌──────────────────────────────────────────────────────────┐
│ LINE 機器人管理                          [+ 新增機器人] │
├──────────────────────┬───────────────────────────────────┤
│ 機器人 (3)           │ ▸ 台灣福祉AI客服 ● 執行中    ⋯ │  ← Bot info 折疊 header
│                      │ Channel Cxxx*** · 9群 · 今日 45 │
│ ● 台灣福祉AI客服     │ ─────────────────────────────    │
│   twh · 9群 · 3分前  │ 所有群組 (9)     [重新拉群名稱] │
│                      │ ─────────────────────────────    │
│ ● 鮮勇小助手         │ 群組              分派部門  最近 │
│   xyu · 3群 · 1天前  │ 改裝報工群        [改裝部▾] 3分前│
│                      │ 沐浴車保養群      [保養部▾] 12分 │
│ ○ dev bot            │ 研發討論群        [未分派▾] 1小時│
│   test · 0群         │ Cxxx8abc… 未命名  [未分派▾] 5分前│
└──────────────────────┴───────────────────────────────────┘
```

### 6.3 左 pane · Bot 列表

- 每 row：狀態 dot · Bot name · tenant slug · 群數 · 最近 event 時間
- 選中 row · `--primary-tint` bg · 左邊 accent border
- 狀態 dot：
  - ● 綠 = active + webhook 已驗證
  - ● 灰 = active + webhook 未驗證
  - ○ 空 = disabled
- 空狀態：「尚無機器人」大字 · 若 aiproot_admin 顯示 CTA 引導新增

### 6.4 右 pane · Bot detail（未選 bot）

Empty state：
```
      🤖 (svg icon)
   選擇左側機器人查看詳情
   (aiproot_admin 才顯示)
   或點右上「新增機器人」建立
```

### 6.5 右 pane · Bot detail（選中 bot · Groups 優先）

**Bot info collapsible header**（預設收起）：
- 收起狀態：`▸ [Name]  ● [status]     [⋯ 動作]`
- 副標：`Channel Cxxx*** · N 群 · 今日 M events · Webhook 已驗證`

**展開狀態**：
```
▾ 台灣福祉 AI 客服             ● 執行中           [編輯][停用]

  Channel ID       Cxxx1234567abc···                   [複製]
  Channel Secret   ●●●●●●●●●●●●                       (由 aiproot 管)
  Access Token     ●●●●●●●●●●●●                       (由 aiproot 管)
  Webhook URL      https://xxx/api/line/webhook       [複製]
  首次驗證         2026/07/20 22:00
  最近 event       3 分前
  累計 events      812
```

**Groups table**（主體）：
- 欄位：群顯示名稱 · Group ID (mono truncated · hover 全顯) · 分派部門（inline dropdown）· 累計 events · 最近 event · Phase 2 「開啟分析」toggle（本輪 disabled）
- Inline dropdown：`react-aria Select` · 選中自動存 · optimistic update · toast 成功/失敗
- 未命名群顯示 `Cxxx8abc…（未命名）` · 有「重試拉名稱」單 row icon 按鈕
- 已離開群（status='left'）用 muted 色 + 「已離開」pill
- 空狀態：「Bot 尚未加入任何群 · 加入後 groupId 會自動出現 · 通常群內任何訊息即觸發」

### 6.6 新增機器人 drawer（右側抽屜 · aiproot_admin only）

**觸發**：點 [+ 新增機器人] · 右側滑出 drawer 遮蓋右 pane
**寬度**：480–560px
**表單**：
- 機器人名稱（text · required · e.g. "台灣福祉 AI 客服"）
- 隸屬租戶（Select dropdown · required · tenants list）
- Channel ID（text · required · 說明「LINE Developer Console → Provider → 你的 Channel → Basic settings 頂端」）
- Channel Secret（password · required · 說明「Basic settings 頁 · Channel secret 欄位」）
- Channel Access Token（password · required · 說明「Messaging API 頁 · Channel access token · 若沒有需 Issue」）
- 儲存 → 若 OQ-LI-6 採建議「Test call」→ 呼叫 LINE `GET /v2/bot/info` 驗 token · 過才寫入
- 成功後：drawer 關閉 · 左 pane 新 bot 出現 · 自動選中 · 右 pane 顯示新 bot detail 含 webhook URL
- 失敗 toast 「Access Token 無效 · 請檢查 LINE Console」

### 6.7 編輯 Bot drawer（aiproot_admin only）

- 同樣右側 drawer · 預填現況
- 可修改 name / secret / token · 不可改 channel_id 或 tenant（避免混淆）
- 選填「更新 Channel Secret」/「更新 Access Token」toggle · 沒 toggle 就不動原值
- 若 toggle 開 · 相關欄位變 required
- 儲存 → 若動過 secret / token · 再走一次 Test call

### 6.8 停用 Bot（aiproot_admin only）

- 點「停用」→ Modal 確認 · warning「停用後 webhook 事件不再處理 · 已收 groups 保留 · 可重新啟用（OQ-LI-8）」
- 確認後：status → 'disabled' · 左 pane bot 變 ○ · Groups table 可看不可編輯

### 6.9 設計 profile 校驗

觀察對標（rule `feedback_frontend_design_principles` §A5 對標 ≥3 競品）：
- **Stripe Radar → Rules**：master-detail · left compact · right rich
- **Linear → Settings/Members**：drawer 新增 · inline edit
- **Grafana → Data Sources**：list + detail · 極簡 hairline
- **Metabase → Admin**：table + inline actions

均對標 observability-light · hairline borders · muted status colors · no gradients。**不與現有 sidebar 衝突**（groups 都放 sidebar 左 · 內容區獨立）。

---

## 7. 安全模型

| 面向 | 對策 |
|---|---|
| Channel Access Token / Secret 存 DB | pgcrypto AES-256 加密 · pattern 同 llm-config |
| pgcrypto encryption key | 復用 `LLM_CONFIG_ENC_KEY` 或另建 `LINE_CONFIG_ENC_KEY`（OQ-LI-5） |
| Webhook 驗簽 | HMAC-SHA256(rawBody, channel_secret) · 匹配 X-Line-Signature |
| Destination lookup 失敗 | Return 200 + log warn（不能拋錯，否則 LINE 重試） |
| 新增 Bot 權限 | 只 aiproot_admin（OQ-LI-3 裁定） |
| 檢視 Bot | tenant_admin 只看 own tenant · aiproot_admin 全看 |
| Access Token 永不 return plaintext | GET API 一律遮罩 · UI 顯示 `Bearer ***xxxx` |
| Audit log | 新增 / 編輯 / 停用 Bot · 分派 department · 全記 |

---

## 8. 容量估算（首客台灣福祉）

- 9 群 · 每群 50–100 訊息 / 天 → 450–900 events/day per bot
- Webhook 平均延遲需 < 1s（LINE 3s timeout）· 現有 stack 純 log 應 <100ms
- DB：line_bot 首年 <30 rows · line_group 首年 <200 rows · 忽略不計
- 若擴到 10 tenant × 平均 5 bot × 平均 8 群 = 400 rows · 仍完全在單 pg 承載範圍

---

## 9. 失效場景反思（FMEA）

| # | 場景 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|
| 1 | webhook 未驗簽 → 任何人 POST 假 event 灌 DB | groupId 假資料 · UI 亂 | **P0** | ✅ HMAC 強制驗證 · 失敗直接 401 |
| 2 | destination 對應不到 bot（bot 刪了但 webhook 還在） | 200 return 但無操作 | P2 | ✅ 200 + warn log · 不當異常 |
| 3 | 同 event LINE 重送 | event_count 多算 | P2 | ⚠️ 殘留 · M1 決是否加去重（少量無傷） |
| 4 | Channel Secret 錯（新增時打錯） | 驗簽永遠失敗 · 拿不到 groupId | **P1** | ⚠️ 殘留 · UI 詳情頁顯示「未驗證」· admin 需重輸 |
| 5 | pgcrypto key 遺失（LLM_CONFIG_ENC_KEY） | 所有 bot access token / secret 無法解密 · 全掛 | **P0** | 🔒 外部 gate · key 需 backup 到 secret manager（現況 .env 只本地備份） |
| 6 | Bot 被踢出群 → LINE 送 leave event | 過舊 group 顯示「已離開」 | P2 | ✅ leave event → status='left' |
| 7 | Fastify raw body plugin 沒開 | 簽章計算對不上 · 一切 webhook 掛 | **P0** | ✅ M1 開發時第一個檢查 |
| 8 | tenant_admin 誤把群分派錯部門 → 後續分析結果進錯部門 | 資料污染 | P1 | ⚠️ 殘留 · UI 分派後有「確認」二次點 · audit log 可追 |
| 9 | 同一群加入兩個 bot（testing / prod）| 分析可能雙倍 · 或衝突 | P2 | ⚠️ 殘留 · 一個 groupId 可能同時屬多個 bot · UI 需展示「群共存 bot」warning · Phase 2 才會 exercise 這風險 |
| 10 | LINE service outage · webhook 停送 | 錯過 events 期間新群 detect 不到 | P2 | ✅ LINE 有 outage log · 恢復後 event 重送 |
| 11 | Access Token 過期（LINE 官方帳號 token 通常永久，但可 rotate） | Phase 2 push 失敗 · Phase 1 影響小 | P2 | ⚠️ 殘留 · aiproot_admin 需重貼 |

**P0 未緩解**：#5 pgcrypto key backup → **上 prod 前需外部 gate 完成**（推 secret manager）· 現況 .env 本地備份不足。

---

## 10. 觀測

- **Log**：每次 webhook call · struct log with `{tenantId, botId, groupId, eventType, sigOk, latencyMs}`
- **Metric**：per-bot event count（每天 / 每小時）· UI 展示 sparkline
- **Alert**：Bot 已 verify 但 12 小時無 event → 可能被踢或 webhook 斷 · 通知 aiproot_admin
- **Debug**：`last_event_raw` JSONB 存最新 payload · 排查用

---

## 11. 成本

- LINE Messaging API webhook receive：**免費**
- LINE Push message：Phase 2 才用 · 有收費（每月免費額度）
- DB storage：忽略
- CPU：webhook 每筆 < 10ms（僅驗簽 + upsert）· 對現有 Render tier 無壓

---

## 12. 兼容 · 遷移

- **既有 notify 模組**：token 在 env（`LINE_CHANNEL_ACCESS_TOKEN`）· 這輪**不動 notify**。但同一 channel_id 未來需要「合併治理」（如新 line_bot 表 vs env）· Phase 2 決策。
- **既有 tenant / department / role**：全部復用 · 不改。
- **既有 sidebar / route / audit / permission** infrastructure：sweep 一遍（rule_outer_shell_sweep）· 加 route / crumb / page title / audit action。

---

## 13. Open Questions

### 已裁定（本輪對話 · 2026-07-21）

| # | 題目 | 決定 |
|---|---|---|
| OQ-LI-1 | Bot 資產屬 aiproot 廣 vs 客戶自建 | ✅ aiproot 統一廣 |
| OQ-LI-2 | 一個 Bot 對應 tenant 關係 | ✅ One Bot = One Tenant（bot_id 綁死 tenant_id） |
| OQ-LI-3 | tenant_admin 是否可自助新增 Bot | ✅ 不可 · 只 aiproot_admin |
| OQ-LI-4 | webhook URL 結構 | ✅ 統一 endpoint · 靠 destination（payload 內 channel ID）分辨 |
| OQ-LI-5 | pgcrypto key 復用 `LLM_CONFIG_ENC_KEY` 還是另建 `LINE_CONFIG_ENC_KEY` | 🟨 **採建議另建 · 待用戶反對** |
| OQ-LI-6 | 新增 Bot 時要不要 test call LINE API 確認 token 真實可用 | 🟨 **採建議做 · 待用戶反對** |
| OQ-LI-7 | Group 顯示名稱怎麼拉？ | 🟨 **採建議「背景 try 一次 · 失敗 truncated · 有重試」· 待用戶反對** |
| OQ-LI-8 | Bot 停用時 · line_group rows 保留還是清除 | 🟨 **採建議保留 · 只 mark bot disabled · 待用戶反對** |

---

## 14. M1–M4 拆解

| 里程 | 內容 | 估算 | 完成準則 |
|---|---|---|---|
| **M1 · Backend 骨架** | migration 0008 · line_bot / line_group table + RLS + pgcrypto · webhook controller + 驗簽 · destination lookup · idempotent upsert · REST CRUD endpoints | 1.5–2 天 | 單元測試 · 手動 curl 送 mock event 拿到 groupId |
| **M2 · Frontend UI** | Sidebar · /line-bots 列表 · /line-bots/:id 詳情 · /line-bots/new 表單 · 3 方向設計圖先給用戶選 | 1.5–2 天 | 手動走完新增 → 拿 webhook URL → 貼 LINE Console → 加群 → 群裡發訊息 → UI 出現群 |
| **M3 · Prod 上線 + 台灣福祉切入** | Migration 上 prod · Bot 新增（台灣福祉 · 既有 channel token） · webhook URL 貼 LINE Console · 客戶群成員各發一句 hi · 拿到 9 個 groupId · tenant_admin 分派 department | 0.5 天 | 9 群全部出現 · 全部分派 department |
| **M4 · docs 收尾** | line-ingest.md 標 APPROVED · MODULES.md 標 ✅ · README 章節加「LINE Bot 管理」使用說明 · FMEA P0 #5 secret manager 上線前 gate 開單 | 0.5 天 | doc 齊備 |

**總估算**：**3.5–5 天**

---

## 15. Cross-cutting checks（rule_cross_cutting_checks）

- ✅ **Security**：pgcrypto AES-256 · HMAC 驗簽 · access token 永不 return plaintext · RLS · role guard · audit log
- ✅ **Observability**：struct log · per-bot metric · alert 12h 無 event
- ✅ **Cost**：webhook receive 免費 · Push 到 Phase 2 才收費
- ✅ **Compat**：不動 notify · 不動既有 tenant / department / role · sidebar sweep 過

---

## 16. Pre-mortem（rule_pre_mortem_user_triggered_paths · 3 題）

**Path**：aiproot_admin 新增 Bot + tenant_admin 分派 department

1. **5× concurrent** — 5 個 aiproot_admin 同時新增 Bot for 同一 tenant · 同一 channel_id
   - 影響：channel_id UNIQUE constraint 擋掉重複 · UI 需捕 500 錯誤變成友善「已存在」提示
   - 緩解：M1 做 gracefully handle

2. **Abuse** — 惡意 aiproot_admin 用假 access token 建 100 個 Bot 塞 tenant
   - 影響：DB 資源 · tenant UI 亂
   - 緩解：M1 加 per-tenant Bot count limit（預設 10）· OQ-LI-6 test call 攔阻假 token

3. **Race condition** — 群主同時把 bot 加進 9 群 · 9 個 join event 幾乎同時進來
   - 影響：Postgres upsert 有 transaction · 應 OK · 但要驗
   - 緩解：M1 unit test 併發 20 個 event 檢查最終 line_group rows 正確

---

## 附錄 · 引用文件

- `docs/modules/notify.md` — 既有 LINE channel 使用 · Push 端
- `docs/frontend-design-principles.md` — UI 對標 observability-light
- memory `feedback_frontend_design_principles.md` · `feedback_no_generic_ai_design.md`
- memory `rule_module_design_flow.md` · `rule_fmea_before_ship.md` · `rule_pre_mortem_user_triggered_paths.md`
- CLAUDE.md R6 · R11 · R13
