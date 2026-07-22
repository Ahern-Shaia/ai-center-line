# warroom-task-board.md — [Priority-2] Warroom 任務看板 · 群組日誌與任務追蹤

> ✅ **狀態：APPROVED v1.0（2026-07-22）· OQ-WTB-1..10 全採建議 · 進 M1**
>
> **裁定摘要**（用戶批次 OQ 全採建議）：
> - WTB-1 → B · 擴 record schema · pipeline prompt 加抽 assignee + due_at
> - WTB-2 → A · 新分類自動 active（pilot 期低摩擦 · v2 收緊）
> - WTB-3 → B · v1 不加 employee role（依賴 employee-line-binding v1.0 綁定完成後 v2 加）
> - WTB-4 → B · 高信度任務 push 主管私訊（非群 · 保群靜默）
> - WTB-5 → A · confidence 降級 · 標「已撤銷」不刪
> - WTB-6 → A + C · 有 due_at 用 due · 無用 7 天保底
> - WTB-7 → B · 否認 = confirm=否認 + 自動 label 反饋 pipeline
> - WTB-8 → A · aiproot 進戰情室下拉選 tenant
> - WTB-9 → B · Kanban assignee JOIN line_member.display_name
> - WTB-10 → B · 分類 slug 用 pipeline · display_name 分離
>
> Scope: **實現台灣福祉需求文件「功能一 · LINE 群組日誌與任務看板」** — 從 `analysis_result` 現有 `daily_reports` / `records` 產出 · 抽 high-confidence 「需追蹤」項升為 `tickets`；建 tenant-scoped `category_registry` 讓分類越用越有系統；戰情室看板依角色分視角（aiproot / 總經理 / 部門主管）。
>
> **核心產品原則**：對齊 CLAUDE.md §0 「不改變工廠員工的 LINE 使用習慣」— 使用者感受是「後台自己會整理」· 不主動打擾群裡對話。
>
> **依賴上游（皆已 SHIPPED）**：
> - [[line-ingest]] v1.0 — LINE webhook + 群組落庫
> - [[convo-analysis-realtime]] v0.4 — 每日 08:00 cron batch → analysis_upload / analysis_result
> - [[permission-engine]] v1.0 — RBAC · 29 permissions
> - [[tenant-provisioning]] v1.0
> - `warroom` module — 現有 dept_count / signoff_rate 三環儀 · 現讀 `tickets`（demo mock）
> - `signoff` module — 簽核狀態機 (待簽核 / 已簽核 / 逾時警示)
>
> 相關：
> - [[convo-analysis-realtime]]（訊息 → 分析）
> - `docs/../台灣福祉/階段一/台灣福祉 LINE智能應用功能說明.md`（需求原文）
>
> 作者：Claude Code（草擬）
> 版本：v0.1（2026-07-22）

---

## 1. 目標與範圍

### 1.1 目標

1. **群組日誌自動化**：每日 batch 產出的 `daily_reports` 直接在戰情室後台顯示 · 各群當日活動一目瞭然（現況 batch 已跑但客戶看不到）
2. **任務自動抽出**：從 `records` 中 `confidence=high` 的項目 · 自動升為 `tickets` · 帶負責人 + 預計完成時間（Q2A 裁定）
3. **分類越用越系統**：新表 `category_registry` per tenant · pipeline 先看既有分類能否歸入 · 真新才自動新增（Q3 裁定每 tenant 一份）
4. **看板角色分視角**：aiproot 見全平台 · 總經理見全公司 · 部門主管見自己部門任務（Q3 裁定）
5. **簽核追蹤閉環**：客戶登入 → 看任務 → 標「已簽核」/「重派」/「否認」→ 分析標對錯反饋 pipeline 準確度

### 1.2 對應 stakeholder 訴求（台灣福祉需求文件）

| 子題 | 需求文件敘述 | 對應本 module |
|---|---|---|
| 群組日誌 | 「機器人會默默讀取每個群組的對話內容，自動整理成當天的日誌」 | A3 · warroom aggregate 顯示 daily_reports + A4 · 前端日誌 tab |
| 需追蹤 → 任務 | 「對話裡如果出現這件事需要有人處理...系統會自動把它獨立標記成一項任務」 | A1 · records → tickets · confidence=high 篩選 |
| 自動分類 | 「先看有沒有已經建立好的分類可以歸進去，有的話就直接歸類，真的是全新性質才自動開一個新分類」 | A2 · category_registry + pipeline prompt 注入 |
| 看板 UI | 「這些任務會整理成一個類似看板的畫面，登入系統就能查看進度」 | A4 · 前端任務看板 |
| 案例：總經理交辦 → HR 主管回覆 | 「總經理登入系統，就能直接在看板上看到這件事目前的狀態」 | A3 · role-scoped 看板 · 總經理視角看全公司 |
| 底層機制共用 | 「功能二會直接運用功能一的對話資料，共用同一套底層機制」 | 保留 pipeline 中立 · 未來 [[personal-daily-report]] M0-B 可 reuse |

### 1.3 不做的事

- ❌ **功能二 · LINE 個人日報**（獨立 M0-B · 等 Q1 員工綁定機制討論）
- ❌ **主動 push 通知回 LINE 群**（違反 CLAUDE.md §0 原則 · 需 OQ-WTB-4 裁定是否例外）
- ❌ **RAG 智慧檢索**（獨立 rag-conversations.md）
- ❌ **Ragic 寫回**（data-sync-layer 已有）
- ❌ **員工個人化 role**（新 `employee` role · 需 Q1 綁定機制先定 · OQ-WTB-3 討論）
- ❌ **手動加任務**（v1 全自動 · v2 若需要再加）

---

## 2. 上游 / 既有現況走查

| 子題 | 上游現況 | Gap |
|---|---|---|
| 群組收訊 → 落庫 | ✅ line-ingest v1.0 SHIPPED | 無 |
| 每日 batch → analysis_result | ✅ convo-analysis-realtime M2/M3 SHIPPED | 無 · pipeline 產 classifications / daily_reports / records 三大類 JSON |
| `records` 是什麼結構 | ✅ 有 · `analysis_result.records` jsonb | 每筆有 `category` / `summary` / `confidence` / `source_ids` · **無 assignee / due_date**（need schema 擴 · Q2A 要最少 2 欄）|
| `tickets` 表 schema | ✅ 已建（seed-demo 有）· 欄位含 `summary` / `confidence` / `confirm_status` / `needs_review` / `department_id` | 需檢查是否夠 · 可能加 `assignee_display_name` / `due_at` / `source_upload_id` |
| Warroom aggregate | ✅ `warroom.service.ts` 讀 `tickets` | 現讀全 tenant · 需擴 role-scoped filter |
| 前端戰情室頁 | ✅ `warroom/WarRoom.tsx` 有骨架 · 現顯 demo 資料 | 需加日報 tab + 任務明細抽屜 |
| Signoff 狀態機 | ✅ `signoff.service.ts` (已簽核 / 逾時警示) | 需綁真實 tickets · 不再 mock |
| 分類 registry | ❌ 現 pipeline 用 fixed 分類 set | 全新建 · migration + repo + prompt 注入 |
| Records → tickets 材料化 | ❌ 完全沒有 | 全新 service · batch 完後跑 |

---

## 3. 剩餘 scope 切分

| 子題 | 內容 | 估算 |
|---|---|---|
| **A1 Records → Tickets 材料化** | 新 `TicketMaterializerService` · batch 完後執行 · confidence=high 過濾 · minimal field mapping · records.source_ids 對回 line_message | 0.05 mo |
| **A2 分類 registry** | migration `category_registry` · repo · pipeline prompt 注入既有分類 · 新分類自動落庫（or 待 review · OQ-WTB-2） | 0.06 mo |
| **A3 Warroom aggregate role-scoped** | `warroom.service` 依 role 篩 · aiproot 見全 · tenant_admin 見該 tenant · group_owner 見部門（依 line_group.department_id → 對應 tickets.department_id） | 0.04 mo |
| **A4 看板前端 UI** | 現有 `WarRoom.tsx` 加日報 tab + 任務明細抽屜 · click ticket 開右側 drawer 顯 records 原始對話（reuse convo-analysis Detail） | 0.06 mo |
| **A5 簽核迴圈** | 綁真實 tickets · 「已簽核 / 重派 / 否認」actions · 否認觸發 label（reuse analysis_label） | 0.03 mo |
| **A6 通知策略**（OQ-WTB-4）| aiproot 內部 Slack log · 客戶端由 OQ 裁定是否 push LINE | 0.02 mo（依 OQ 而定）|
| **A7 分類管理 UI** | aiproot / tenant_admin 頁 · rename / merge / disable 分類 | 0.03 mo |

**合計**：M0 + M1-M5 = **0.29 mo（約 6 週工程日 · 依人力和 OQ 裁定 scope）**

---

## 4. A1 · Records → Tickets 材料化

### 4.1 資料模型

現有 `tickets` 表已足夠（來自 seed-demo 觀察）· 只加 3 欄：

```sql
-- migration 0016_task_board.sql · 部分
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS assignee_display_name text,        -- 從對話中的「派給誰」抽 · Q2A 最少欄位 #1
  ADD COLUMN IF NOT EXISTS due_at                 timestamptz, -- 從對話中的時間承諾抽 · Q2A 最少欄位 #2
  ADD COLUMN IF NOT EXISTS source_upload_id       bigint REFERENCES analysis_upload(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_record_index    integer;    -- 對回 analysis_result.records[N] · 供 UI 展開對話 context
```

### 4.2 邏輯

新 `TicketMaterializerService.materialize(uploadId)`：

```typescript
async materialize(uploadId: number): Promise<{ inserted: number; skipped: number }> {
  const bundle = await this.analyzeService.getUploadWithResult(uploadId);
  if (!bundle?.result?.records) return { inserted: 0, skipped: 0 };

  let inserted = 0, skipped = 0;
  for (const [idx, rec] of bundle.result.records.entries()) {
    if (rec.confidence !== "high") { skipped++; continue; }         // Q2A 只 high

    // 從 record 抽 assignee + due_at（現有 record schema 已含 assignee / deadline_at）
    const assignee = rec.assignee_display_name ?? null;
    const dueAt = rec.deadline_at ? parseDateISO(rec.deadline_at) : null;

    // department_id 從 upload.group_id → line_group.department_id snapshot
    const dept = await this.deptFromGroup(bundle.upload.tenantId!, bundle.upload.groupId);

    await this.ticketRepo.insert({
      tenantId: bundle.upload.tenantId!,
      departmentId: dept?.departmentId ?? null,
      summary: rec.summary ?? "（無摘要）",
      category: rec.category,                                          // 走 category_registry (§5)
      confidence: rec.confidence,
      confirmStatus: "待簽核",
      needsReview: false,
      assigneeDisplayName: assignee,
      dueAt: dueAt,
      sourceUploadId: uploadId,
      sourceRecordIndex: idx,
    });
    inserted++;
  }
  return { inserted, skipped };
}
```

### 4.3 觸發

- **Batch 完後自動觸發**：`AnalysisBatchService.runBatch` 尾端 · upload status = "done" 時追加 materialize（or setImmediate 排非同步）
- **手動觸發**：aiproot「對話分析歷程」加「材料化為任務」button · 已 completed 的 batch 可 re-materialize（用於 re-classify 後回補）

### 4.4 冪等

- 同 `(source_upload_id, source_record_index)` 已存在的 ticket · re-materialize 走 UPDATE（不新增第 2 筆）
- 若 record 的 confidence 從 high 降為 medium · 該 ticket **軟刪** or **標 status=撤銷**？→ OQ-WTB-5

---

## 5. A2 · 分類 registry

### 5.1 資料模型

```sql
-- migration 0016_task_board.sql · 部分
CREATE TABLE IF NOT EXISTS category_registry (
  category_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  category_name     text        NOT NULL,                       -- e.g. "維修工單" / "客訴" / "訂單追蹤"
  category_slug     text        NOT NULL,                       -- 標準化 slug · pipeline JSON key
  description       text,                                        -- aiproot / 主管註明用途
  usage_count       integer     NOT NULL DEFAULT 0,              -- 累計被歸入次數
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at      timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        REFERENCES users(user_id),       -- null = AI 自動新增
  status            text        NOT NULL DEFAULT 'active'        -- 'active' | 'archived' | 'pending_review'
    CHECK (status IN ('active', 'archived', 'pending_review')),
  UNIQUE (tenant_id, category_slug)
);

CREATE INDEX IF NOT EXISTS ix_category_registry_tenant ON category_registry (tenant_id);

ALTER TABLE category_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_registry FORCE ROW LEVEL SECURITY;
CREATE POLICY category_registry_tenant_isolation ON category_registry USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
);

-- tickets.category 補 FK (soft · category_registry 生命週期比 ticket 短)
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES category_registry(category_id) ON DELETE SET NULL;
```

### 5.2 Pipeline 注入

修改 `runPipeline`（`server/src/conversation-analysis/pipeline/index.ts`）：

```typescript
export async function runPipeline(rawText, tenantSlug, provider, tenantId?: string) {
  const tenant = resolveTenant(tenantSlug);
  const knownCategories = tenantId
    ? await categoryRepo.listActive(tenantId)
    : DEFAULT_CATEGORIES;                                    // fallback for manual upload

  // 注入 system prompt：「已知分類：[維修工單, 客訴, 訂單追蹤, ...] · 優先歸入 · 全新性質才新增」
  const enrichedTenant = { ...tenant, knownCategories };
  ...

  for (const seg of segments) {
    const { result, usage } = await analyzeSegment(provider, groupName, seg, enrichedTenant);
    // 新分類 detection · result.classifications 中含未在 knownCategories 的 · 落庫（OQ-WTB-2 · auto or pending_review）
    for (const c of result.classifications) {
      if (!knownCategories.find((k) => k.slug === c.category)) {
        await categoryRepo.upsert(tenantId!, {
          slug: c.category,
          name: c.category,                                  // Q3 每 tenant · v1 用 slug 當 name · aiproot 可 rename
          status: AUTO_APPROVE_CATEGORY ? "active" : "pending_review",
          createdBy: null,                                    // null = AI 自動
        });
      }
    }
    ...
  }
}
```

### 5.3 UI

新頁「AIPROOT 管理 → 分類管理」or「設定 → 分類管理」（依 role）：
- 列 category · usage_count · last_used · status
- Rename / archive / merge to another category
- Pending_review 分類 · aiproot approve 才 active

---

## 6. A3 · Warroom aggregate role-scoped

### 6.1 邏輯

修改 `warroom.service.ts`：

```typescript
async warroom(): Promise<WarroomDto> {
  const tx = currentTx();
  const user = /* current user from tenant.interceptor */;

  // role-scoped filter
  let deptFilter = sql`TRUE`;
  if (user.role === "aiproot_admin" || user.role === "consultant") {
    // 全平台 · 不過 tenant scope 仍要（避免混租戶 report）· 用 query param tenantId
    deptFilter = sql`t.tenant_id = ${scopedTenantId}::uuid`;
  } else if (user.role === "tenant_admin") {
    // 該 tenant 全部（RLS 已限）
  } else if (user.role === "group_owner") {
    // 部門主管 · 只 owned 部門
    deptFilter = sql`t.department_id IN (
      SELECT department_id FROM departments
      WHERE tenant_id = current_setting('app.current_tenant')::uuid
        AND owner_user_id = ${user.userId}
    )`;
  }
  // 未來新 employee role · 加 assignee_display_name = user.displayName

  const tks = await tx.execute<TicketRow>(sql`
    SELECT t.* FROM tickets t WHERE ${deptFilter}
  `);
  ...
}
```

### 6.2 日誌 tab

Warroom 加日誌 view · 讀 `analysis_result.daily_reports`：

```sql
SELECT ar.daily_reports, au.uploaded_at, au.group_id, ...
FROM analysis_result ar
JOIN analysis_upload au ON au.id = ar.upload_id
WHERE au.tenant_id = <scoped> AND au.batch_date = <selected day>
ORDER BY au.uploaded_at DESC
```

- 前端 tab 切「任務」/「日誌」
- 日誌下鑽：click 某群某日 → 顯 daily_reports 內容

---

## 7. A4 · 看板前端 UI

### 7.1 元件

現有 `WarRoom.tsx` 骨架 → 3 個 tab：
- **總覽儀表**（現有 三環儀 · 依 role scope）
- **任務看板**（新 · Kanban 列 by status: 待簽核 / 執行中 / 已簽核 / 逾時）
- **今日日誌**（新 · daily_reports 每群一 card）

### 7.2 Kanban 列 (任務看板)

- Column: 待簽核 / 已簽核 / 逾時警示
- Card：ticket summary · assignee (若有) · due_at (若有) · category tag
- Click card → 右側 drawer 顯：
  - 完整 summary
  - 原始 records 對話 context（跳 convo-analysis Detail 該 uploadId）
  - Signoff actions（已簽核 / 重派 / 否認）

### 7.3 日誌 view

- 頂日期選（today / yesterday / 過去 7 天）
- 每群一 card：`daily_reports` 各項目條列
- Click 群 → 跳 convo-analysis Detail 看該日全對話

---

## 7-bis. 企業級 cross-cutting 檢核（Mode B 必填）

### 7-bis.1 安全模型

| 攻擊面 | 緩解 | 對應 |
|---|---|---|
| tenant_admin 誤看他 tenant 任務 | RLS · tickets tenant_id 隔離 | 已有 |
| group_owner 越權看非自己部門 tickets | A3 role-scoped filter | 新加 owner_user_id check |
| aiproot 讀 tickets 內文 · PII 洩漏（任務 summary 含員工真名） | audit_log 記查詢 | 新加（P0 · [[convo-analysis-realtime]] §12.7 P0-2 同源） |
| Records → tickets 材料化被 abuse（多次 re-run 生大量 ticket） | 冪等 · UNIQUE (source_upload_id, source_record_index) | A1.4 |
| Category registry 惡意新增 · 濫用命名 | pending_review 狀態 · aiproot approve · slug 長度限 | A2 · OQ-WTB-2 |

Input validation：
- `ticket.summary` max 500 char · truncate
- `category.slug` max 50 char · slug 化 (`/[a-z0-9_-]+/`)
- `assignee_display_name` max 100 char

### 7-bis.2 容量規劃

台灣福祉 · 9 群 · 每群每天 100 訊息 · 假設 5% 升任務：
- 每天 45 tickets · 一年 16,400
- 10 tenant × 一年 164,000 tickets · Postgres bigserial OK
- category_registry · 每 tenant 100 分類上限 · 全 registry ~1,000 rows

Critical query：
- `warroom.warroom()` 主 query · JOIN tickets + departments + users · index 命中要好
- Kanban 篩選 by status · `tickets(tenant_id, confirm_status)` composite index

### 7-bis.3 失效模式

| 路徑 | 失效 | 緩解 |
|---|---|---|
| `materialize(uploadId)` throws | 已 materialize 部分 · 部分未 · UNIQUE 保防 rerun 不重複 | 冪等 |
| Category registry lookup 失敗 | fallback DEFAULT_CATEGORIES · 不 crash | try/catch |
| record 缺 assignee / due_at | assignee_display_name = null · due_at = null · 任務仍建 | schema NULLABLE |
| Batch complete 但 materialize 卡住 | 前台無 tickets · 用戶登入看空 | log warning · aiproot 手動 re-materialize |

### 7-bis.4 觀測性

| 指標 | 用途 |
|---|---|
| `ticket_materialized_total{tenant, source}` | 每 batch 產出多少 ticket |
| `category_new_total{tenant, status}` | 新分類產生率 · 太多 = prompt 不穩 · 太少 = 分類已穩定 |
| `warroom_query_duration{role}` | 各 role 篩選效能 |
| `signoff_action_total{action}` | 已簽 / 重派 / 否認 分佈 · 反映 AI 品質 |
| Alert：`ticket_materialized_total 為 0 for 2 days` | batch 有跑但沒 ticket · 可能 confidence 全 low or pipeline 壞 |

### 7-bis.5 資料生命週期

- `tickets` 保 3 年（工廠稽核）· archive to S3 Glacier 之後
- `category_registry` 永久保留（分類是 tenant 資產）
- `daily_reports` 隨 `analysis_result` 保 3 年
- PII 標記：`ticket.assignee_display_name` · GDPR erasure 需求 → soft delete + 匿名化（v2）

### 7-bis.6 向後兼容 + Rollout

- Migration 0016 · 新表 + tickets +4 欄 · 全新 · 不 breaking
- API：新 endpoint `/warroom/tasks`、`/category-registry/*` · 舊 `/warroom` 保留 · 加日誌 tab
- Feature flag：env `WTB_MATERIALIZE_ENABLED` default true · kill switch

### 7-bis.7 成本模型

- Pipeline 內 prompt 加已知分類 · 每 batch input tokens +100-300 · 每 batch cost +$0.001-0.003 · 可忽略
- Category registry lookup · 每 batch 前 1 次 DB query · <10ms · 可忽略
- Materialize · 每 upload 1-10 INSERT · <100ms · 可忽略

**Total incremental cost**：** < $0.01 / batch** · 極輕量

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | materializer confidence 過濾 · category slug 化 · role filter SQL 生成 | `server/test/warroom-task-board.*.test.ts` |
| Integration | batch complete → materialize → tickets exist · role-scoped query 正確 · category upsert 冪等 | `server/test/integration/` |
| Smoke | M4 收尾 · 台灣福祉真實 batch 走完整 pipeline | `docs/smoke/warroom-task-board.md` |

至少 **10 個 unit tests**（materialize 4 · category 3 · role filter 3）。

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 預估 | 狀態 |
|---|---|---|---|
| **M0** design review | 本檔 → APPROVED（OQ-WTB-1..10 全裁）| 0.02 mo | ⏳ |
| **M1** Materializer + tickets 4 欄 | A1 · migration 0016 · TicketMaterializerService · 4 tests | 0.05 mo | ⏳ |
| **M2** Category registry | A2 · pipeline prompt 注入 · 新分類落庫 · 3 tests | 0.06 mo | ⏳ |
| **M3** Warroom role-scoped + 日誌 | A3 · warroom.service 加 role filter · daily_reports read · 3 tests | 0.06 mo | ⏳ |
| **M4** 前端 3 tab (儀 / 任務 / 日誌) | A4 · WarRoom.tsx 大改 · Kanban + drawer + daily card | 0.06 mo | ⏳ |
| **M5** 簽核 + 分類管理 UI | A5 + A7 · 綁真實 tickets · category rename/merge UI | 0.05 mo | ⏳ |
| **M6** 通知 + FMEA 收尾 | A6（OQ-WTB-4 依裁定）· §12 FMEA · P0 全清才上 prod | 0.03 mo | ⏳ |

---

## 10. 開放問題（OQ-WTB-N）— 待裁定

| # | 訴求 | 議題 | 選項 | 建議 |
|---|:-:|---|---|---|
| **OQ-WTB-1** | ③ | Records 是否已含 assignee / due_at 欄 | A. 現 schema 已含 · 我 grep 確認<br>B. 需擴 record schema · pipeline prompt 加抽這 2 欄<br>C. 只從對話文字硬 parse（不擴 schema）| **B** — schema 明確含 · pipeline 準確度高 · 硬 parse 易錯 |
| **OQ-WTB-2** | ② | 新分類生成後 · 立即 active 還是待 aiproot review | A. 自動 active · aiproot 事後可 archive<br>B. Pending_review · aiproot approve 才生效<br>C. 兩層：aiproot 自己 tenant 自動 · 客戶 tenant 待 review | **A** — pilot 期低摩擦 · 客戶進正式再收緊改 B |
| **OQ-WTB-3** | ①⑤ | 加「employee」role · 讓員工看自己任務 | A. 加 · v1 就做（依賴功能二綁定機制）<br>B. 不加 · 部門主管代員工看<br>C. 加但預留 · v1 stub · 功能二上線再開 | **B** — 減 v1 scope · 依賴 Q1 綁定機制未定 · 主管代看足夠 |
| **OQ-WTB-4** | ①④ | 高信度新任務 · 是否 push LINE 群通知 | A. 不 push · 對齊 §0「不主動說話」原則 · 客戶登入才看<br>B. 只 push 到主管私訊（非群）· 保原則<br>C. Push 到部門群 · 但含 opt-out 開關<br>D. 由客戶決定 · UI 加開關 | **B** — 保持群靜默 · 主管私訊即時感 · 完全對齊「不改變員工使用習慣」|
| **OQ-WTB-5** | ② | Record confidence 從 high 降 · 對應 ticket | A. 標「已撤銷」不刪 · 主管人工 review<br>B. 軟刪 · UI 不顯 · DB 保<br>C. 硬刪 | **A** — 保追溯 · 主管可判「這 record AI 改判 low · 但實際是 high · 手動維持」 |
| **OQ-WTB-6** | ④ | Ticket 逾時定義 | A. `due_at` 過期即逾時（AI 抽的日期）<br>B. `due_at` + 2 天緩衝<br>C. 無 due_at 的 · 建立後 7 天未簽即逾時 | **A + C 混合** — 有 due_at 用 A · 沒 due_at 用 C 保底 |
| **OQ-WTB-7** | ⑤ | 「否認」action 觸發什麼 | A. 只標 confirm_status=已否認 · 不影響 pipeline<br>B. A + 自動觸發 label（reuse analysis_label · confidence=low）· 供 pipeline retrain<br>C. B + 分類 registry 該類 usage_count -= 1 | **B** — 反饋 pipeline · Registry 動投票會複雜 · v2 再說 |
| **OQ-WTB-8** | ⑤ | Role scope · aiproot 進戰情室看時 | A. 需下拉選 tenant · 一次看一家<br>B. 全平台聚合 view · 各 tenant 一列<br>C. 兩者都做 · 頂 toggle 切 | **A** — 對齊「AI 成本管理」pattern · 使用者已熟 |
| **OQ-WTB-9** | ⑤ | 前端 Kanban 顯示 assignee | A. AI 抽的 assignee 直接顯 · 未抽到就顯「未指派」<br>B. Assignee 用 line_member.display_name JOIN 對齊<br>C. B + 若 assignee 對到 users 表 email · 也 link 到 aiproot user 帳號 | **B** — 對齊 [[line-ingest]] member 表 · 未來 C 需 Q1 綁定機制先定 |
| **OQ-WTB-10** | ② | 分類 slug 化規則 | A. Direct 用 AI 產的原文（可能中文含空格）<br>B. Slugify（英文 lowercase 加底線 · 中文保留但去空格）<br>C. UUID slug + display_name 分離 | **B** — 折衷 · slug 用於 pipeline · display 用於 UI |

---

## 11. SOP — 日常操作

（M4 補齊 · 現階段草擬）

### 11.1 aiproot 首日設置

1. 進「AIPROOT 管理 → 分類管理」→ 選台灣福祉
2. 檢視 AI 自動產生的分類 · rename 為業務語言（e.g.「品保客訴」→「客訴 - 品保部」）
3. 進「戰情室」→ tenant 切台灣福祉 → 看儀表 + 任務看板 · 檢查是否合理

### 11.2 tenant_admin（總經理室）日常

1. 早上進戰情室 → 看「今日日誌」了解各群昨日活動
2. 切「任務看板」→ 看昨日新產出的任務
3. 逐個 review：合理 → 「已簽核」· 錯 → 「否認」· 需重派 → 「重派」
4. 定期看「逾時警示」欄 · 追執行狀況

### 11.3 group_owner（部門主管）日常

1. 進戰情室看**自己部門**的任務看板
2. 「已簽核」自己執行完成的
3. 分派任務給部屬（線下 · v1 不做系統內指派）

### 11.4 失敗模式排查

| 症狀 | 含意 | 處置 |
|---|---|---|
| 今日 batch 有跑但 tickets 沒新增 | Materializer 卡住 or 全 low confidence | 查 log · 手動 re-materialize |
| 分類爆炸性成長 (每天 5+ 新分類) | Pipeline prompt 沒吃到既有分類 or category_registry 讀不到 | 檢查 pipeline 內 knownCategories 是否非 empty |
| 主管看不到部門任務 | line_group.department_id 沒分派 or ownership 未設 | 進「LINE 機器人 → 群組」分派 · 或設 department owner |

---

## 12. 失效場景反思（FMEA）— 收尾必填（R17）

（M6 收尾 · 現階段草擬骨架）

### 12.1 Materializer 路徑

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| MZ1 | Batch 完但 materialize 沒觸發 | tickets 空 · 前台無 · 用戶困惑 | ⏳ 需 M6 監控 metric | P1 |
| MZ2 | 同 (upload, record_idx) 重跑 | UNIQUE 冪等 · UPDATE 不重複 | ⏳ | P1 |
| MZ3 | Record 缺 assignee / due_at | NULL · 任務仍建 · UI 顯「未指派」 | ⏳ | P2 |
| MZ4 | Records 中含 PII (個資) · materialize 落 tickets | 已在 line_message 就存 · 這裡不新增暴露 | ⏳ | P1 |

### 12.2 Category registry 路徑

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| CR1 | Pipeline 產出重複 slug（AI 產「客訴」和「客訴投訴」）| category_registry 兩筆 · aiproot 手動 merge | ⏳ | P2 |
| CR2 | 分類爆長（每天 5+ 新） | usage_count 觀察 · alert 提示 aiproot | ⏳ | P1 |
| CR3 | Registry 讀失敗 | fallback DEFAULT_CATEGORIES · pipeline 不 crash | ⏳ | P1 |

### 12.3 跨租戶隔離

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| X1 | tenant_admin 誤登他 tenant 看 tickets | RLS 擋 · SELECT 0 rows | ⏳ 沿用現有 | **P0** |
| X2 | group_owner 越權看非自己部門 | A3 role filter · SELECT 該部門 only | ⏳ 需 test | **P0** |
| X3 | aiproot 讀 ticket 內文 audit | 現無 · 需 M6 加 audit_log 記查詢 | ⏳ | **P0** |

### 12.4 部署順序

| # | 場景 | 風險 | 緩解 |
|---|---|---|---|
| D1 | Migration 0016 未跑 · code 已推 | tickets 4 欄不存在 · materialize 500 | migration 必先（R10 人工跑）|
| D2 | Pipeline 已改吃 category_registry · 但 registry 空 | Fallback DEFAULT · 不 crash | 設計時保底 |
| D3 | 舊 tickets（demo mock）與新 materialize 共存 | UI 分不出 · 需 seed 清或 source_upload_id IS NULL 判斷 | M6 · 上 prod 前清 demo tickets |

### 12.5 不在本 module scope 修的既存問題

- **功能二個人日報**：M0-B 獨立 · 依賴 Q1 綁定機制
- **RAG 檢索**：獨立 rag-conversations.md
- **Ragic 寫回**：data-sync-layer
- **X3 audit log**：與 [[convo-analysis-realtime]] §12.7 P0-2 同源 · 建議合一設計

### 12.6 上 prod 前必清（P0 gate）

| # | 項目 | 狀態 | 阻擋動作 |
|---|---|---|---|
| P0-1 | X1 · tenant_admin 跨 tenant 阻擋 | ✅ 沿用 RLS | — |
| P0-2 | X2 · group_owner 部門 filter | ⏳ M3 test 覆蓋 | 加 role filter unit test |
| P0-3 | X3 · aiproot audit log | ⚠️ 未建 | M6 前必補 |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-22 | v0.1 | 初版 DRAFT · 7 sub-task + OQ-WTB-1..10 · FMEA 骨架 · 對應台灣福祉需求文件功能一 | Claude Code |
| 2026-07-22 | **v1.0** | ✅ **APPROVED**（用戶批次 OQ 全採建議）· 10 條 OQ 全裁定 · 狀態 DRAFT → APPROVED · 進 M1 · 依賴 [[employee-line-binding]] v1.0 方向 8（Zero-Config）· 依賴 [[convo-analysis-realtime]] pipeline reuse · v2 才加 employee role（等綁定成熟後） | Claude Code + 用戶拍板 |
