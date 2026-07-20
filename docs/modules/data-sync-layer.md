# data-sync-layer.md — [P1 起手式] 中介資料層（Data Sync Layer）M0 設計文件

> ✅ **狀態：APPROVED — OQ-DSL-1..12 全裁定（2026-07-20 · 全採建議）· 待進 M1**
>
> **PDF §11 一句話**：「同時動手搭中介資料層的骨架（P1 起手式 5.1），因為後面所有『跟催提醒／報價查詢／戰情室』都要靠這層資料才能做。**不要每個功能各自兜資料，否則以後換客戶、換 ERP 就要全部重寫一次**。」
>
> **本 module 定位**：EEA 超級平台三層架構的**資料智能層核心**（see [[project_product_line_architecture]]）· ERP-agnostic · 未來所有 P1 功能（跟催 / 報價查詢 / 戰情室 / 對話分析 / 通知）的資料 baseline。
>
> **依賴上游**：
> - `server/src/notify` v1.0 SHIPPED（未來走 §8 三階段切換遷移進本層）
> - `server/src/conversation-analysis` M1 SHIPPED（未來 upload 走本層 raw store · label 走本層 audit）
> - `server/src/auth` / `server/src/tenant`（tenant tx / RLS 慣例）
>
> **依賴下游**（未來實作）：所有 P1 5.x-6.x 功能
>
> 相關：LINE CRM PDF §5.1 · §2.3 三層架構 · §7 拍板決策 · §8 三階段切換規範
>
> 作者：Claude Code
> 版本：v0.1（2026-07-20）

---

## 1. 目標與範圍

### 1.1 目標

1. **建立獨立於 Ragic 的資料同步服務**：定期 or 事件觸發、從 Ragic API 拉資料（訂單 / 客戶 / 聯絡人）、正規化後存自有 DB
2. **介接來源可替換**（Source Connector 抽象）：未來換 ERP（weyver / SAP / 鼎新）只換 Connector、上層 AI / LINE 功能不動
3. **統一資料格式**：不論資料從 Ragic / LINE 訂單辨識 / 手動 upload 進來、最終存成同一份 schema
4. **Ragic 斷線緩衝 + 自動補寫**：Ragic API 短期無法連線時、寫自有 DB 標「待寫入 Ragic」、背景重試（graceful degradation · 不擴大寫入權限野心）
5. **三階段切換規範**（PDF §8）：階段一 現有 JS Workflow 繼續、階段二 影子通知比對、階段三 對照 20 筆真實事件一致後才正式切
6. **多租戶開銷計費 baseline**（PDF §5.12 要求）：per-tenant token / API call / 儲存量統計，供未來計費模型
7. **不做整合層**：不做 AI 分析、不做 UI、不做通知 — 純資料層 · 服務下游

### 1.2 對應 Stakeholder 訴求

| 訴求 | 來源 | 對應點 |
|---|---|---|
| 「不要每個功能各自兜資料、否則以後換客戶換 ERP 就要全部重寫一次」 | PDF §11 給工程師的一句話 | 本 module 全部 |
| 「不論資料怎麼進來、都要能轉成統一格式」 | PDF §5.1 中介資料層核心價值 | §4 資料模型 + §5 Connector |
| 「介接來源可替換」 | PDF §5.1 | §5 Source Connector interface |
| 「Ragic API 短期無法連線」風險 | PDF §5.1 · Ragic Uptime SLA 一般方案沒保證 | §6 斷線緩衝 |
| 「三階段切換規範」 | PDF §8 | §7 影子通知 + 對照工具 |
| 「多租戶開銷嚴謹統計」 | PDF §5.12 | §8 計費 baseline |

### 1.3 Scope 選項比較與 rationale · 為什麼「起手式」現在做

M0 propose 三種節奏、用戶裁定 B：

| 選項 | Scope | 工程量 | 節奏 | 建議度 |
|---|---|---|---|---|
| A · 繼續 conversation-analysis pilot M2（web 3 頁）· §5.1 延後 | 3 日 | 快 pilot 進度 · 但強化「各自兜資料」anti-pattern | ❌ 逆 PDF §11 |
| **B · 暫停 pilot M2 · 先開 §5.1 M0 · 之後 pilot 併軌 §5.1** | 1-2 日 M0 · M1-M6 待裁定 | 對齊 PDF §11 起手式順序 | ✅ **v0.4 裁定** |
| C · 併行 · pilot M2 縮 scope + §5.1 M0 同做 | 3 日 | 折衷 · 兩者都不深 | ⚠️ 折衷風險 |
| D · 全戰略對齊 doc 優先 · pilot 和 §5.1 都停 | 1-2 日純文件 | 純規劃 · 無交付 | ⚠️ 純文件無 code |

**選 B rationale 三條**：
1. **PDF §11 明說 P1 起手式**：中介資料層先建 · 其他功能才能靠它
2. **Pilot backend 已 SHIPPED · 有 rest 空間**：不緊急 · §5.1 M0 只 1-2 日投入
3. **不 lock in · design doc 給 OQ 讓你裁定 · pilot 是否併軌 M1 開始前決定**

### 1.4 不做的事（scope 邊界）

- ❌ **AI 分析**（分類 / 抽取 / 摘要）· 那是資料智能層之上的 AI 智能層 · 屬 conversation-analysis / notify compose 等 module
- ❌ **UI**（管理介面 / dashboard）· 純 backend module · Stage 2 才做 SAM 融合 UI
- ❌ **通知發送**（LINE Push）· 走 notify module 現有基建
- ❌ **Ragic 寫回優化**（如批次 / diff）· pilot 階段 · 單筆同步 · SaaS 才 optimize
- ❌ **AI 訂單辨識 · OCR**（PDF §5.1 道霖需求）· **分開 M** 做 · 屬「資料擷取環節」· 不是同步層核心
- ❌ **多資料湖 / Kafka / Debezium 等 heavy infra**· pilot 階段 Postgres + BullMQ 即可
- ❌ **Real-time streaming** · 定期 pull + 事件 push 混合、非 real-time
- ❌ **Migration 現有 notify / conversation-analysis 資料**· 三階段切換是漸進、舊 module 保留運作

---

## 2. 上游 / 既有現況走查

| 元件 | 現況 | Gap |
|---|---|---|
| Ragic API | ✅ 用過（`server/.env` 有 RAGIC_ACCOUNT / API_KEY · notify module 未用到 · 對話分析 pipeline 亦未用）| 需寫 Connector wrapper |
| Notify audit `notification_log` | ✅ SHIPPED · 每筆通知有 tenant_id / sheet_path / record_id | 未來 audit 走中介層 audit 表、notify 遷移 · **本 M 暫不動** |
| Conversation-analysis `analysis_upload` | ✅ M1 SHIPPED · pilot 一手上傳 · 直存 Postgres text column | 未來 upload 也走本層 raw store · **本 M 暫不動 · Stage 2 併軌** |
| Tenant module | ✅ tenant / department 表 + JwtUser + RLS `currentTx()` | 中介層 tables 需 tenant_id + RLS · reuse |
| Auth guards | ✅ JwtAuthGuard + RolesGuard · 四角色 | Connector 呼叫是 backend job · 不走 request-time auth · 需另設「system actor」概念 |
| Cron / Scheduler | ❌ 無 | 新增 · 用 `@nestjs/schedule`（decorator @Cron） |
| Job queue | ❌ 無（現況 setImmediate） | 新增 BullMQ + Redis（**Redis 已在 docker-compose** · 從 memory `reference_dev_run.md` 提示）· 若 Redis 缺 · pilot 可 fallback in-memory |
| Data model | ❌ 無 | 新增 · Zod schema for 訂單/客戶/聯絡人 標準格式 |

---

## 3. 剩餘 scope 切分（M1-M6）

| M | 內容 | 估算 |
|---|---|---|
| **M0** | 本檔 → APPROVED（用戶裁 OQ-DSL-1..12）| 0.02 mo（0.5 日）|
| **M1** | Data model + Source Connector interface + Ragic Connector（首個 implementation）· pull 訂單/客戶/聯絡人 三 entity | 0.10 mo（3 日）|
| **M2** | Scheduler（cron pull every N min）+ Job queue（BullMQ）+ Ragic 斷線緩衝（graceful degradation 佇列）| 0.08 mo（2.5 日）|
| **M3** | 影子通知 · §8 階段二實作 · dual-write 影子 audit table · 對照工具（比對現行 vs 中介層通知）| 0.08 mo（2.5 日）|
| **M4** | Multi-tenant 開銷計費 baseline · per-tenant metrics（token / API call / storage）| 0.05 mo（1.5 日）|
| **M5** | 三階段切換規範落地 · 對照 20 筆真實事件工具 · 通過門檻自動判定 | 0.05 mo（1.5 日）|
| **M6** | FMEA + 遷移 SOP（notify / conversation-analysis 各自併軌計畫、非本 M 落地、只寫計畫）| 0.05 mo（1.5 日）|

**Stage 1 合計**（M1-M6）：約 **13 人日**（不含 M0）

**待 M6 完成後、才決定 pilot / notify 遷移時程**（各自獨立 M · 非本 module scope）

---

## 4. Data Model（M1 詳）

三大 canonical entities（Ragic 拉出來後正規化格式）：

### 4.1 Order（訂單）

```typescript
// server/src/data-sync-layer/models/order.ts
export const OrderSchema = z.object({
  id: z.string().uuid(),                    // 自產 UUID · 內部 primary
  tenantId: z.string().uuid(),
  sourceConnector: z.enum(['ragic', 'weyver', 'sap', 'manual']),
  sourceRecordId: z.string(),               // Ragic ragicId / weyver recordId
  sourceSheetPath: z.string().optional(),   // Ragic /account/tab/id
  orderNo: z.string(),                      // 業務單號 · 客戶語意
  customerId: z.string().uuid().nullable(), // FK to Customer entity
  customerName: z.string(),                 // denormalized · 快查詢
  orderDate: z.string().date().nullable(),
  expectedDeliveryDate: z.string().date().nullable(),
  status: z.string().nullable(),            // 客戶 enum · e.g. 「已核可」/「已交貨」
  amount: z.number().nullable(),
  currency: z.string().default('TWD'),
  ownerName: z.string().nullable(),         // 承辦業務
  raw: z.record(z.unknown()),               // 原始 payload · 保留 troubleshoot
  syncedAt: z.string().datetime(),
  writeBackStatus: z.enum(['synced', 'pending', 'failed']).default('synced'),
});
```

### 4.2 Customer + Contact（客戶 + 聯絡人）

（同 pattern · 略）

### 4.3 Sync log

```typescript
// 記錄每次 Connector pull / push 的 audit
export const SyncLogSchema = z.object({
  id: z.number().int(),
  tenantId: z.string().uuid(),
  connector: z.string(),
  operation: z.enum(['pull', 'push', 'backfill', 'shadow']),
  entity: z.enum(['order', 'customer', 'contact']),
  recordsProcessed: z.number(),
  errors: z.number(),
  latencyMs: z.number(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  metadata: z.record(z.unknown()),
});
```

### 4.4 DB Migration 0006（見 §9）

`data_sync_order` / `data_sync_customer` / `data_sync_contact` / `data_sync_log` / `data_sync_writeback_queue` 五張表。

---

## 5. Source Connector Interface（M1 詳）

### 5.1 抽象介面（TypeScript · 未來每 ERP 一 impl）

```typescript
// server/src/data-sync-layer/connectors/base.ts
export interface SourceConnector {
  readonly name: string;              // 'ragic' | 'weyver' | 'sap'
  readonly tenantId: string;

  // Pull · 拉最近 N 筆 · 由 scheduler 觸發
  pullOrders(since?: Date, limit?: number): Promise<Order[]>;
  pullCustomers(since?: Date, limit?: number): Promise<Customer[]>;
  pullContacts(since?: Date, limit?: number): Promise<Contact[]>;

  // Push · 未來 SaaS 才需要 · pilot M1 skip
  // pushOrder?(order: Order): Promise<{ sourceRecordId: string }>;

  // Health · 用於斷線偵測（§6）
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}
```

### 5.2 Ragic Connector（首個 implementation）

- 用 `RAGIC_ACCOUNT / RAGIC_API_KEY` env（reuse notify 已有 setup）
- Ragic REST API 拉 sheet records `/api/http/{account}/{tab}/{sheetId}`
- Sheet path 對照 config：每 tenant 設定「訂單 sheet path」/「客戶 sheet path」等
- Ragic ragicId → 存 `sourceRecordId`
- **只讀不寫**（PDF §2.3 三層架構 ERP 交易層唯讀）

### 5.3 未來 weyver Connector（M6 sketch · 不本期做）

- weyver 用 TypeScript 自研 · 可以直接 import 或 HTTP API
- 若走 HTTP API · 同 pattern 只改 endpoint
- 若走 process import · 需在 monorepo 化後才能 · Pilot 不做

---

## 6. Ragic 斷線緩衝機制（M2 詳 · PDF §5.1）

```
新資料要寫 Ragic → Ragic healthCheck() → 可連線 → 直接寫入 Ragic
                                       ↓ 無法連線
                                  寫本地佇列 data_sync_writeback_queue
                                  status=pending
                                       ↓
                        背景 worker（每 30s 重試）→ 成功則 status=synced
                                                    失敗 N 次則 status=failed + alert
```

`data_sync_writeback_queue` schema：
```sql
CREATE TABLE data_sync_writeback_queue (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  connector     text NOT NULL,
  entity        text NOT NULL,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','retrying','synced','failed')),
  attempts      int NOT NULL DEFAULT 0,
  last_error    text,
  next_retry_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  synced_at     timestamptz
);
CREATE INDEX idx_writeback_pending ON data_sync_writeback_queue (next_retry_at) WHERE status IN ('pending','retrying');
```

**注意**（PDF §5.1 明確要求）：這**不是**要平台「取代 Ragic」或擴大寫權限、是**單純優雅降級**（graceful degradation）。

---

## 7. 三階段切換規範（M3 · M5 · PDF §8）

### 7.1 影子通知（M3）

現行 notify JS Workflow 繼續執行 · 中介層在背景**同步接收 Ragic 事件**、產生「影子通知」但**不實際發送** · 僅記錄 · 供逐筆對照。

Table：`data_sync_shadow_notification`
- Ragic event id / 現行通知 message_text / 中介層通知 message_text / diff_flag

### 7.2 對照工具（M5）

CLI + web page 顯示 · 「至少 20 筆真實事件完全一致才可切階段三」

### 7.3 階段三正式切換 SOP（M6 遷移計畫、不本 M 落地）
- 詳見 [[notify-multi-tenant §11.0 push checklist]] · pattern reuse

---

## 8. Multi-tenant 開銷計費 baseline（M4）

per-tenant 3 個開銷源（PDF §5.12 要求嚴謹）：
- 訊息處理（Anthropic token count · per-request 記帳）
- 雲端多媒體儲存（S3 upload count + size）
- 知識庫查詢流量（vector DB query count）

Table `data_sync_tenant_usage`：
```sql
CREATE TABLE data_sync_tenant_usage (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  category      text NOT NULL     -- 'llm_tokens' | 'storage_bytes' | 'kb_queries'
    CHECK (category IN ('llm_tokens','storage_bytes','kb_queries')),
  amount        numeric NOT NULL,
  metadata      jsonb,
  ts            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_tenant_ts ON data_sync_tenant_usage (tenant_id, ts DESC);
CREATE INDEX idx_usage_tenant_cat_ts ON data_sync_tenant_usage (tenant_id, category, ts DESC);
```

---

## 9. 資料模型變動 · Migration 0006

見 §4-8 · 統一在 migration `0006_data_sync_layer.sql`：
- 5 表（order / customer / contact / sync_log / writeback_queue / tenant_usage 六張，本節誤數為五）
- 都掛 `tenant_id` + RLS policy（若 M1 就開 RLS · OQ-DSL-8）
- Grant to `app_rw`

---

## 9-bis. 企業級 cross-cutting 檢核（Stage 1 適用性）

### 9-bis.1 安全模型
- Ragic API key 存 env（reuse notify pattern）· 不入 code
- Connector Ragic 只呼 pull endpoint · 不呼 write endpoint（PDF §2.3 硬紀律）
- 佇列內 payload 含客戶 PII · 加密選 field-level or at-rest 全加（OQ-DSL-6）
- Cross-tenant 隔離：RLS by tenant_id + 系統 actor 需明確 tenant context

### 9-bis.2 容量
- Pilot 客戶 3 家 · 訂單 <1000 筆 · 客戶 <500 筆 · daily pull 3 次 = negligible
- SaaS 100 客戶 × 每客戶 1 萬訂單 = 100 萬 rows · Postgres 完全負擔得起

### 9-bis.3 失效模式
| 路徑 | Timeout | Retry | Fallback |
|---|---|---|---|
| Ragic pull | 30s per request · 3 次 exponential backoff | 失敗 → sync_log 記 error · alert | 下次 cron 續拉 |
| Writeback queue retry | 30s · 5 次 exp backoff · 最大 24h · 24h 後 status=failed alert | | 人工介入 |
| Shadow notification 對照 | 純比對 · 無外呼 | n/a | log diff |

### 9-bis.4 觀測性
- `sync_log` 每次 pull/push 一筆
- Metrics：per-connector pull success rate / avg latency / errors
- Alert：sync_log 失敗率 > 10% / 5 min → notify（reuse notify module 推 dev 群）

### 9-bis.5 資料生命週期
- `data_sync_order/customer/contact` 資料類：跟 Ragic 同步 · 客戶要刪就雙邊刪
- `sync_log` 保留 90 天
- `writeback_queue` synced/failed 保留 30 天
- `tenant_usage` 保留 1 年（計費用）

### 9-bis.6 向後兼容 + Rollout
- 三階段切換（§8）· 舊 notify JS Workflow 保留運作、雙軌並行、對照通過才正式切
- Rollback：backend rollback + writeback queue drain 恢復 Ragic 直寫 pattern

### 9-bis.7 成本
- Pilot：Postgres +6 表 · 每天 <10 MB · Anthropic API 0（本層不呼 LLM）· Redis Job queue · ~$0/月
- SaaS 100 客戶：Postgres +GB 級 · Redis + BullMQ · ~$50-100/月

---

## 10. 開放問題（OQ-DSL-N）· ✅ 全裁定（2026-07-20 · 全採建議）

| # | 議題 | 裁定 | 裁定理由 |
|---|---|---|---|
| **OQ-DSL-1** | Pull 節奏 | ✅ **A · Cron every 15min** | pilot 業助工作節奏日級 · 15min pull 已夠 real-time · D 未來 SaaS 加 |
| **OQ-DSL-2** | Storage 型式 | ✅ **A · Postgres relational** | YAGNI · SaaS 後有 analytics 需求才加資料湖 |
| **OQ-DSL-3** | Job queue | ✅ **A · BullMQ + Redis** | 事實標準 · Redis 已在 docker-compose · pilot 級也用真 queue 避免 rework |
| **OQ-DSL-4** | Connector interface 抽象化 | ✅ **B · TypeScript interface + Zod schema** | 型別安全 + runtime 驗證 · pilot 級剛好 |
| **OQ-DSL-5** | 訂單辨識 OCR 是否本 M 做 | ✅ **B · 分獨立 M** | 道霖需求真來時再做 · raw payload 欄位保留供未來擴 |
| **OQ-DSL-6** | PII 加密 | ✅ **B · At-rest 靠 Render 內建** | Render Postgres 已 AES-256 · pilot 級足夠 · field-level 是 SaaS 才加 |
| **OQ-DSL-7** | Data model 範圍 | ✅ **A · 訂單 + 客戶 + 聯絡人（3 entity）** | pilot 3 個核心已滿足所有 P1 功能（跟催 / 報價 / 戰情室 / 對話分析）|
| **OQ-DSL-8** | RLS 何時開 | ✅ **A · M1 就開 RLS** | reuse tenant tx pattern · 從一開始開避免 rework |
| **OQ-DSL-9** | Ragic sheet path 對照設定位置 | ✅ **B · tenant.registry 擴展** | reuse notify tenant registry pattern · 一致 |
| **OQ-DSL-10** | 三階段切換 20 筆對照工具 | ✅ **A · CLI 對照 script** | pilot 一次性 · CLI 快 · SaaS 再加 web |
| **OQ-DSL-11** | Pilot / notify 遷移時程 | ✅ **B · 本 M 只寫遷移計畫 · 遷移各自獨立 M** | 各 module 各自決定何時遷 |
| **OQ-DSL-12** | 命名 | ✅ **A · `data-sync-layer`** | 對齊 PDF §5.1「資料同步層」· Sync 比 Mediation 更精確描述 pull/push |

---

## 11. SOP · 開發流程

（M1-M6 完成後補完整 SOP · 本 M0 skeleton）

### 11.1 新增 Ragic sheet 對照（tenant admin 操作）
1. 在 `tenant.registry.ts` 加 `ragicSheetPaths.order = '/erp/1'`
2. Deploy · scheduler 下次 tick 自動 pull

### 11.2 加新 ERP Connector（未來 weyver）
1. `server/src/data-sync-layer/connectors/weyver.ts` 實作 `SourceConnector` interface
2. tenant.registry 加 `connector: 'weyver'`
3. Scheduler 依 tenant 分派到對應 Connector · zero code change to scheduler

### 11.3 三階段切換執行流程
- 階段一 → 階段二：deploy 影子通知 code + 手動 review 24 hr diff
- 階段二 → 階段三：對照工具驗 20 筆連續一致 + 通過 checklist

---

## 12. 未來擴展

- **weyver Connector**（Solo 開發 R1 完成後）
- **OCR / 表格辨識**（道霖需求真來、獨立 M）
- **AI 訂單摘要**（PDF §6.1 · 資料智能層依賴本層）
- **戰情室 dashboard**（reuse warroom · 資料來源改本層）

---

## 15. 失效場景反思（FMEA · M6 收尾必填 · R17）

### 15.1 Connector · Ragic API

| # | 場景 | 影響 | Sev |
|---|---|---|---|
| C1 | Ragic API rate limit hit | 拉取失敗 · sync_log 記 error | P1 |
| C2 | Ragic sheet path 錯 · 拉不到資料 | 靜默 0 筆 | **P0**（要有 sanity check：<expected 拉筆數 alert）|
| C3 | Ragic 回傳 schema 變 | 我方 zod parse fail | P1 |
| C4 | tenant.registry 缺 sheet path config | Connector 跳過該 tenant | P1（config validation boot check）|

### 15.2 Writeback queue

| # | 場景 | 影響 | Sev |
|---|---|---|---|
| Q1 | Ragic 長時間 down（>24h）· queue 累積 | 記憶體 / DB 空間爆 | P1（監控 queue size · 超過 1000 筆 alert）|
| Q2 | Writeback conflict（Ragic 端有人也改了）| 覆蓋客戶編輯 | **P0**（要有 optimistic lock · Ragic ragicId 版本比對）|

### 15.3 三階段切換

| # | 場景 | 影響 | Sev |
|---|---|---|---|
| S1 | 階段二影子通知 diff 誤判為一致 · 階段三切錯 · 業助群訊息變樣 | **客戶投訴** | **P0**（20 筆對照工具需嚴格 · 由人審 · 不 auto） |
| S2 | 階段三切完 · 現行 JS Workflow 沒真的關掉 · 雙發 | 業助收到 duplicate | P1（切換 SOP 有明確關閉舊 workflow 步驟）|

### 15.4 Multi-tenant 開銷

| # | 場景 | 影響 | Sev |
|---|---|---|---|
| T1 | Token usage 沒歸帳到 tenant · 計費失準 | 收款不對 · SaaS 才嚴重 · pilot 影響小 | P2（M4 加測試） |

---

## 16. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-20 | v0.1 | 初版 DRAFT · Scope P1 起手式中介資料層 · M1-M6 · OQ-DSL-1..12 · FMEA skeleton · 依 EEA PDF §5.1 / §7 / §8 / §11 設計 · 對齊 [[project_product_line_architecture]] | Claude Code |
| 2026-07-20 | v0.2 | OQ-DSL-1..12 全裁定（用戶全採建議）· 狀態 DRAFT → APPROVED · 待進 M1 | Claude Code |
