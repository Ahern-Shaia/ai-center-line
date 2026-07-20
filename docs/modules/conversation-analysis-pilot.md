# conversation-analysis-pilot.md — [Priority-1] LINE 對話分析 · pilot 版（web-based · 兩階段）

> ✅ **狀態：APPROVED v0.3（2026-07-20）· 兩階段 pilot · web-based · leverage 現有後台**
>
> Scope: **用途 B pilot** — 業助登入現有後台 → 上傳 LINE 匯出檔 → 分析 → 直接在 UI 看結果 + 標對錯（label） → 收集 metric。不做 webhook、不寫 Ragic、不做 confirm 迴圈 push（notify 反方向）。
>
> **兩階段設計**：
> - **Stage 1 · Mock validation**（1 個月工程）— 用現有 `samples/` + AI 生成 edge case → 驗證 pipeline 技術可行性 + UI 好不好用
> - **Stage 2 · Real client pilot**（3 個月）— Stage 1 通了才找真客戶、驗證真實污染率、收付費信號、走 M5 三 AND checkpoint
>
> **依賴上游**：
> - `server/src/auth` (JWT+roles+guards) · `server/src/signoff` (審核 pattern reuse for label) · `server/src/warroom` · `server/src/notify` v1.0 SHIPPED · `server/src/tenant`
> - `web/src/Shell.tsx` + `Login.tsx` · warroom 現有頁面 shell
> - 現有 CLI (`src/`) v0.1 · Claude Opus 4.7 pipeline
>
> 相關：[[對話分析功能-可行性反思-2026-07-20]]（本 doc 決策依據）
>
> 作者：Claude Code
> 版本：v0.3（2026-07-20）

---

## 1. 目標與範圍

### 1.1 目標

1. **Stage 1**：業助能在現有後台**上傳 LINE 匯出檔** → 系統跑分析 → **web UI 顯示結果**（classifications / daily_reports / records）→ 業助**點對錯 label**（reuse signoff pattern）
2. **Stage 2**：Stage 1 通了 → 找 1-2 家真客戶 pilot → 驗證真實對話**污染率** + **付費意願**
3. **不承諾**：不接 webhook、不寫 Ragic、不做 Flex confirm 推播、不多客戶自動化
4. **Leverage 現有 asset**：auth / Shell / signoff pattern / notify / warroom 全 reuse、不重造輪子
5. **可決策**：Stage 2 M8 checkpoint（三 AND 條件）判斷是否升級 SaaS

### 1.2 對應 Stakeholder 訴求

| 訴求 | 誰 | Stage | 對應點 |
|---|---|---|---|
| 「pipeline 技術通不通、UI 好用嗎」 | 我方 | Stage 1 | §4-6 mock validation |
| 「業助真的每天需要嗎」 | sandy / pilot 客戶 | Stage 2 | §8 real client cycle |
| 「污染率實際多糟」 | 我方戰略決策 | Stage 2 | §6.3 metric + §8 real data |
| 「pay for R&D」 | 我方 cash flow | Stage 2 | §8 pilot 收費 |

### 1.3 Scope 選項比較與 rationale · 為什麼選 B web-based 兩階段

M0 propose 三輪 iteration、最終裁定路徑：

| 選項 | Scope | 工程量 | 客戶體驗 | Metric 收集 | 裁定 |
|---|---|---|---|---|---|
| ~~A · 純 CLI + PDF/Excel + Google Sheet label~~ | 微量增強 CLI | 2-4 週 | ❌ 多學一工具 | ❌ 人工貼表 | ❌ 忽略現有後台 asset（v0.1 propose、v0.3 supersede）|
| **B · Web 內建 · leverage 現有後台** | 新增 conversation-analysis backend module + 3 web 頁 + reuse signoff pattern | 3-6 週 | ✅ 業助熟悉的介面 | ✅ 系統內 zero friction | ✅ **v0.3 裁定**（利用已 SHIPPED 的 auth+shell+signoff+notify asset） |
| ~~C · Hybrid (web upload + CLI analyze)~~ | Backend upload + web 顯示/label · 分析仍 CLI | 2-4 週 | ⚠️ 折衷 | ✅ | ❌ 折衷、無明顯 win |
| ~~D · 對話污染獨立技術研究~~ | 1-2 週 benchmark | 學術性、缺 human-labeled | ❌ | ❌ | ❌ 無 pilot 客戶付錢跑技術研究 |

**選 B rationale 三條**：

1. **Leverage sunk cost**：戰情室後台已有 auth + Shell + signoff + notify、對話分析用它們 = 零重造輪子；若走 A 則忽略這些 asset
2. **貼客戶工作流**：業助已用戰情室（雖 mock）、加對話分析是「多一個 tab」而非「多學一工具」；心理成本差 10 倍
3. **Metric 收集 zero friction**：label 進 DB → SQL 即可算污染率；A 方案需人工貼 Google Sheet、慢且錯

**未來 pivot 決策點**：Stage 2 M8 checkpoint（OQ-CVA-9）將依 pilot 三大 metric + 客戶付費意願判斷是否升級到 SaaS full（用途 C）。

### 1.4 兩階段設計 · Stage 1 / Stage 2

**Lean startup 精神**：技術風險 vs 商業風險分開驗證、避免拿真客戶當白老鼠。

| Stage | 資料源 | 目的 | 驗證什麼 | 不驗證 | 時效 |
|---|---|---|---|---|---|
| **Stage 1 Mock** | `samples/` 4 檔 + AI 生成 5 edge case | 驗證 pipeline 技術可行性 + UI 好不好用 | Upload/analyze/display/label 四段整合、Signoff reuse pattern 順不順、業助好不好上手 | 真實污染率、付費信號、客戶接受度 | 1 個月工程 |
| **Stage 2 Real client** | 真客戶 LINE 匯出檔 | 驗證真實污染率 + 收付費信號 | 三大 metric（污染率 <20%）、willingness-to-pay、qualitative feedback、M8 三 AND checkpoint | — | 3 個月（M6 起算）|

**Stage 1 → Stage 2 gate**：
- ✅ 技術通（upload/analyze/display/label 四段整合能跑）
- ✅ UI 好用（我方或找一個 friendly user 試用、無明顯 usability 問題）
- ✅ Mock 資料的 accuracy 至少跟現有 CLI 一樣好（不倒退）
- 通過 → 進 Stage 2；不通 → fix or pivot

### 1.5 不做的事（scope 邊界）

- ❌ **LINE webhook / 即時 ingest** — 用途 C 才做
- ❌ **Ragic 寫回 / 主檔 API 拉取** — 用途 C 才做
- ❌ **Flex confirm 推播迴圈** — 業助在後台 UI 內 confirm、不透過 LINE
- ❌ **多客戶自動 tenant provisioning** — pilot 客戶手動配 tenant YAML
- ❌ **PDF/Excel 報告出口**（v0.1 propose 已 supersede）— 若客戶要 export 走 CSV/JSON download
- ❌ **Tier 3 手動 trigger 按鈕 / `/歸檔`** — 明確砍（OQ-CVA-5 · 6 個 abuse 場景）
- ❌ **模型/schema/主檔版本化** — pilot snapshot 一次性
- ❌ **GDPR / retention** — pilot 手動、客戶要刪就手動刪
- ❌ **SaaS 六大件全套** — §14 未來擴展

---

## 2. 上游 / 既有現況走查

### 2.1 現有可 reuse asset（**都不用重造**）

| 元件 | 位置 | Pilot 用途 |
|---|---|---|
| Auth（JWT + roles + guards）| `server/src/auth/` | 業助登入 · reuse |
| Signoff pattern | `server/src/signoff/` | Label 對錯 reuse（M3 見 §6）|
| Warroom module + web page | `server/src/warroom/` + `web/src/WarRoom.tsx` | 業助熟悉的 shell、對話分析頁掛在同 Shell |
| Notify v1.0 SHIPPED | `server/src/notify/` | 分析完可 optional 推 LINE 通知業助群（bundled）|
| Tenant module | `server/src/tenant/` | 多 pilot 客戶隔離 |
| Web Shell + Login + Toast + Drawer | `web/src/{Shell,Login,Toast,Drawer}.tsx` | 對話分析頁 layout / route 進 Shell |
| 現有 CLI pipeline | `src/{parser,classify,schemas,masterData}.ts` | Backend analyze job 直接 import、無需重寫 |

### 2.2 需要新做

| 元件 | 位置 | 說明 |
|---|---|---|
| Backend conversation-analysis module | `server/src/conversation-analysis/` | Upload endpoint + analyze job runner + result API + label API |
| Web 3 頁 | `web/src/ConversationAnalysis*.tsx` | Upload / Result / Label 頁 |
| DB schema | migration 0005 | `analysis_upload` + `analysis_result` + `analysis_label` |
| Mock data | `samples-extra/` | AI 生成 5 edge case + 原 `samples/` 4 檔 |
| Tenant YAML | `tenants/<slug>.yaml` | Stage 2 才需（Stage 1 用 hard-coded 現有兩客戶主檔）|

---

## 3. 剩餘 scope 切分（Stage 1 M1-M5 + Stage 2 M6-M8）

### 3.1 Stage 1 · Mock validation（M1-M5 · 1 個月工程）

| M | 內容 | 估算 |
|---|---|---|
| **M0** | 本檔 → APPROVED v0.3 | 0.02 mo（0.5 日）· ✅ 完成 |
| **M1** | Backend `conversation-analysis` module — upload endpoint / DB schema (0005) / async analyze job（reuse `src/classify.ts`）| 0.10 mo（3 日）|
| **M2** | Web 3 頁（Upload / Result / Label）· Shell 加 route · reuse Toast/Drawer/table 現有 component | 0.10 mo（3 日）|
| **M3** | Label 機制 · reuse signoff pattern · DB label table · accuracy metric SQL views | 0.08 mo（2.5 日）|
| **M4** | Mock data 生成 · 原 `samples/` 4 檔跑通 + AI 生成 5 edge case（不同污染強度）+ 我方 walkthrough | 0.05 mo（1.5 日）|
| **M5** | Stage 1 checkpoint · pipeline 技術通 + UI 好用 + accuracy 不倒退 → 決定是否進 Stage 2；FMEA Stage 1 段 | 0.03 mo（1 日）|

**Stage 1 合計**：約 **11 人日**（~1 個月含 review buffer）

### 3.2 Stage 2 · Real client pilot（M6-M8 · 3 個月）

| M | 內容 | 估算 |
|---|---|---|
| **M6** | 找 pilot 客戶 1-2 家（首選 sandy）· 簽合作 · tenant YAML 配置 · PII cleanup SOP · Onboarding | 0.20 mo（跨月 · 含業務等待）|
| **M7** | Real client cycle × 1-2 家 · 收匯出檔 · 跑 · label · 收 feedback · iterate | 1.5 mo（跨 2-3 個月）|
| **M8** | Metric 收集 + **M5 三 AND checkpoint 決策** · FMEA Stage 2 段 · 是否升級 SaaS | 0.10 mo（3 日）|

**Stage 2 合計**：~3 個月（大部分是等客戶時間）

---

## 4. Stage 1 · M1 Backend `conversation-analysis` module

### 4.1 API 契約

```
POST /conversation-analysis/upload
Headers: Authorization: Bearer <JWT>
Body: multipart/form-data
  file: <LINE 匯出 .txt>
  tenantSlug: string        # M1 Stage 1 hard-code "twh" or "youcheng"（來自現有 CLI）
Response: 202 { uploadId: string, status: "pending" }

GET /conversation-analysis/uploads
Response: [{ id, filename, uploadedAt, status: "pending"|"running"|"done"|"failed", messageCount, segmentCount }]

GET /conversation-analysis/results/:uploadId
Response: {
  upload: {...},
  messages: [{ id, date, time, sender, text, kind, category, confidence, label?: { correct: boolean, note?: string } }],
  dailyReports: [...],
  records: [...],
  usage: {...}
}

POST /conversation-analysis/label
Body: { uploadId, targetType: "classification"|"daily_report"|"record", targetId, correct: boolean, note?: string }
Response: 200 { labelId }

GET /conversation-analysis/metrics
Query: ?uploadId=... | ?tenantSlug=...
Response: {
  contamination_rate: 0.15,     # 錯分類 %
  event_chain_completeness: 0.72,
  entity_mapping_accuracy: 0.88,
  label_count: 340,
  total_items: 400
}
```

### 4.2 檔案結構

```
server/src/conversation-analysis/
  conversation-analysis.module.ts
  upload.controller.ts        POST /upload · GET /uploads
  result.controller.ts        GET /results/:id
  label.controller.ts         POST /label · GET /metrics
  analyze.service.ts          async job runner · reuse src/classify.ts
  label.service.ts            CRUD label + metric aggregation
  dto/
    upload.dto.ts
    label.dto.ts
  __tests__/
    analyze.service.test.ts
    label.service.test.ts
```

### 4.3 Upload storage · Postgres text column

Pilot 檔案量小（<100 KB / 檔）、不需 S3。Postgres text column 存原始 `.txt` 內容 + metadata：

```sql
CREATE TABLE analysis_upload (
  id            bigserial PRIMARY KEY,
  tenant_slug   text NOT NULL,
  filename      text NOT NULL,
  raw_content   text NOT NULL,
  uploaded_by   uuid NOT NULL REFERENCES users(user_id),
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed')),
  error_message text,
  usage_stats   jsonb
);
```

### 4.4 Async analyze job · immediate spawn background promise

Pilot Render single instance → 用 NestJS EventEmitter 或 setImmediate 排 background job，不做正式 queue（SaaS 才需要）：

```typescript
@Post('upload')
async upload(@UploadedFile() file, @CurrentUser() user, @Body() dto) {
  const upload = await this.repo.createUpload({ ... });
  setImmediate(() => this.analyze.runJob(upload.id));  // async, non-blocking
  return { uploadId: upload.id, status: 'pending' };
}

async runJob(uploadId) {
  await this.repo.setStatus(uploadId, 'running');
  try {
    const upload = await this.repo.getUpload(uploadId);
    const { messages, dailyReports, records } = await runPipeline(upload.raw_content, upload.tenant_slug);
    await this.repo.saveResults(uploadId, { messages, dailyReports, records });
    await this.repo.setStatus(uploadId, 'done');
  } catch (e) {
    await this.repo.setStatus(uploadId, 'failed', e.message);
  }
}
```

`runPipeline` 就是把現有 `src/index.ts` 主邏輯搬過來（parser + segmenter + classify.analyzeSegment）、封成 pure function。

---

## 5. Stage 1 · M2 Web pages

### 5.1 Upload 頁 (`web/src/ConversationAnalysisUpload.tsx`)

- 表單：檔案選擇（accept .txt）+ tenant dropdown
- Submit → POST /upload → 顯示 toast「上傳成功、開始分析」→ redirect 到 uploads list
- Reuse: `Shell` layout + `Toast` component

### 5.2 Result 頁 (`web/src/ConversationAnalysisResult.tsx`)

- Route: `/analysis/results/:uploadId`
- Poll GET /results/:uploadId 每 5 秒直到 status=done
- 三個 tab：**訊息分類** / **日報** / **記錄**
- 每筆旁邊：`✓ 對` / `✗ 錯` 按鈕 → POST /label
- Reuse: `Shell` + `Drawer`（訊息詳情）+ 現有 table style

### 5.3 Label queue 頁 (`web/src/ConversationAnalysisLabel.tsx`)

- 匯總「所有未 label 的 candidates」列表 · 可 filter by upload / tenant / category
- 快速標對錯（keyboard shortcut y/n）
- 進度條：labeled / total
- 我方 label 用（不給客戶用）

---

## 6. Stage 1 · M3 Label 機制 · reuse signoff pattern

### 6.1 Signoff pattern audit（Stage 1 M0 完後、M3 開始前 explore）

需驗證：
- signoff 現況是否有 pending → confirmed/rejected 狀態機
- 是否有 label 對象抽象（sheet_row / analysis_item）
- 是否可加 label 對象 type：`classification` / `daily_report` / `record`

**待 M3 開始前 quick explore**（半天）決定 reuse 深度 vs 另建；若 reuse cost > 新建 → 新做 label table

### 6.2 DB schema · migration 0005

```sql
CREATE TABLE analysis_label (
  id            bigserial PRIMARY KEY,
  upload_id     bigint NOT NULL REFERENCES analysis_upload(id) ON DELETE CASCADE,
  target_type   text NOT NULL CHECK (target_type IN ('classification','daily_report','record')),
  target_id     text NOT NULL,        -- classification=msgId, daily/record=index
  correct       boolean NOT NULL,
  note          text,
  labeled_by    uuid NOT NULL REFERENCES users(user_id),
  labeled_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(upload_id, target_type, target_id, labeled_by)
);
```

### 6.3 Accuracy metric 三大定義（SQL views）

**污染率**（cross-talk contamination rate）：
```sql
SELECT 1.0 * SUM(CASE WHEN NOT correct THEN 1 ELSE 0 END) / COUNT(*) AS contamination_rate
FROM analysis_label
WHERE upload_id = $1 AND target_type = 'classification';
```

**Event chain 完整度**：
```sql
SELECT 1.0 * SUM(CASE WHEN correct THEN 1 ELSE 0 END) / COUNT(*) AS event_chain_completeness
FROM analysis_label
WHERE upload_id = $1 AND target_type = 'record';
```

**實體對應準確度**：（label 分開 person / machine_code / work_order 三個 sub-metric，M4 再細）

---

## 7. Stage 1 · M4 Mock data 生成

### 7.1 現有 4 檔（reuse）

- `samples/台灣福祉-改裝群.txt` (42 行 · 34 訊息 · 6 平行話題)
- `samples/報工群.txt` · `研發採購群.txt` · `維保群.txt`

### 7.2 AI 生成 5 edge case（新增到 `samples-extra/`）

用 Claude 生成、每個測不同污染 pattern：

| # | 情境 | 為什麼要測 |
|---|---|---|
| E1 | **極端話題交錯** · 同時段 10 個平行話題、每個只 2-3 則、大量短回覆 | 測 LLM 短回覆歸屬極限 |
| E2 | **跨天長 event chain** · 同一事件跨 3 天、每天訊息數不同 | 測 segment 邊界事件合併 |
| E3 | **人物多角** · 同人在同時段回應 3 個不同話題 | 測 role disambiguation |
| E4 | **多語混雜 + 錯字** · 台語/英文/emoji/typo 混雜 | 測 glossary + robustness |
| E5 | **對話污染 corner case** · 諷刺/玩笑/假訊息（「這批全報廢啦哈哈」）| 測 confidence 抓不抓得出 |

**生成 prompt template** 放在 `samples-extra/GENERATION_PROMPT.md`（用戶 review 後跑）。

### 7.3 Walkthrough

M4 收尾走一次完整流程：登入 → 上傳 mock 檔 → 等分析 → 看結果 → label 幾筆 → 看 metrics dashboard → 驗 UI 順暢。

---

## 8. Stage 2 · M6-M8 Real client pilot（sketch · Stage 1 通後 detail）

### 8.1 M6 · Onboarding
- 找 pilot 客戶（首選 sandy · 台灣福祉）
- 簽合作合約 · 資料處理告知
- 建 `tenants/<slug>.yaml`（客戶主檔 · 見 §14 未來擴展）
- 業助帳號建立 · 授權
- PII cleanup SOP（原檔 30 天刪除）

### 8.2 M7 · Real client cycles
- 客戶匯出 → 我方 upload 到 web → 業助自己 label（或我方 label）
- 每 cycle 收 qualitative feedback
- 我方 sampling 對照 label 算 metric

### 8.3 M8 · Checkpoint 三 AND
- **污染率 < 20%** AND
- **≥ 1 客戶願付 NT$5k/月** AND
- **Qualitative feedback 正面**
- 全滿足 → 走 SaaS MVP（用途 C）
- 任一失敗 → pivot（可能加深 notify、或砍對話分析）
- **3 個月 timebox**（M6 起算）· 超過無決策 → 資源投別處

---

## 9. 資料模型變動

### 9.1 Migration 0005 · conversation-analysis schema

- `analysis_upload` 表（§4.3）
- `analysis_result` 表（存 messages / dailyReports / records 為 JSONB · 便於 UI 直接讀）
- `analysis_label` 表（§6.2）
- 三張表全掛 `tenant_id` for 多 pilot 客戶隔離；Stage 1 用 default tenant twh
- 加 index for query patterns

### 9.2 RLS / Permission

- Stage 1 不掛 RLS（單 pilot 客戶）
- Stage 2 掛 RLS by tenant_id（若多 pilot 客戶並行）

---

## 9-bis. 企業級 cross-cutting 檢核（Stage 1 適用性）

### 9-bis.1 安全模型
- Auth：reuse JWT + roles guard · 業助角色需能 upload/read/label
- Prompt injection：pilot 讀 offline 匯出、風險相對低；出結果後我方 review
- PII：客戶原檔 30 天刪除 SOP（M6 才適用 real client）

### 9-bis.2 容量
- Stage 1: 5-10 uploads/週 × <100 KB · 完全 negligible
- Stage 2: <1 upload/天/客戶 × <500 KB · 仍 negligible

### 9-bis.3 失效模式
- Analyze job 掛 → `status=failed` + error_message · 業助能看見 · 手動 retry
- Anthropic API rate limit → job 失敗、重排
- Upload 大檔（>1 MB） → 拒收 + toast

### 9-bis.4 觀測性
- Stage 1: `SELECT status, COUNT(*) FROM analysis_upload GROUP BY 1` 手工看
- Stage 2: 加 dashboard

### 9-bis.5-7
- Retention / rollback / cost：Stage 1 pilot 階段全部降級適用

---

## 10. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | analyze.service（reuse src/classify.ts 測試）· label.service（CRUD + metric SQL）| `server/src/conversation-analysis/__tests__/` |
| Integration | upload → analyze → result end-to-end（mock LLM）| `server/test/conversation-analysis.e2e-spec.ts` |
| Web | 手動 walkthrough（M4 收尾）· 未來加 Playwright | 手動 |
| Regression | Samples/ 4 檔 mock 資料仍應通（M4 內建）| walkthrough |

---

## 11. 落地順序與里程碑

| M | 內容 | 估算 | 狀態 |
|---|---|---|---|
| **M0** | Design v0.3 APPROVED | 0.02 mo | ✅ 完成 |
| **M1** | Backend `conversation-analysis` module + migration 0005 | 0.10 mo | ⏳ |
| **M2** | Web 3 頁（Upload/Result/Label） | 0.10 mo | ⏳ |
| **M3** | Label 機制 reuse signoff + accuracy metric SQL | 0.08 mo | ⏳ |
| **M4** | Mock data · AI 生成 5 edge case + walkthrough | 0.05 mo | ⏳ |
| **M5** | Stage 1 checkpoint + FMEA Stage 1 段 | 0.03 mo | ⏳ |
| **M6** | Real client onboarding × 1-2 家 | 0.20 mo | ⏳ |
| **M7** | Real client cycles | 1.5 mo | ⏳ |
| **M8** | Metric + Stage 2 三 AND checkpoint + FMEA Stage 2 段 | 0.10 mo | ⏳ |

---

## 12. 開放問題（OQ-CVA-N）· ✅ 全裁定（2026-07-20）

### 12.1 Pilot 本期 OQ（1-4）

| # | 議題 | 裁定 | 裁定理由 |
|---|---|---|---|
| **OQ-CVA-1** | 報告輸出格式 | ✅ **web UI 內顯示 + optional CSV/JSON download**（v0.3 supersede v0.1 的 Excel/PDF）| 業助直接在後台看 + label；export 為 optional convenience |
| **OQ-CVA-2** | 客製主檔套用 | ✅ **A · YAML config 檔**（Stage 2 才需 · Stage 1 hardcode 現有 2 客戶）| YAML 直觀 · version control friendly |
| **OQ-CVA-3** | Label 機制 | ✅ **reuse signoff pattern**（v0.3 supersede v0.1 的 Google Sheet）| Signoff module 已 SHIPPED · pattern reuse cost 遠低於新建 |
| **OQ-CVA-4** | Pilot 收費模式 | ✅ **一次性 NT$10-30k / client / cycle**（Stage 2 才適用）| Pilot 一次性合理 · 訂閱等 SaaS |

### 12.2 未來 SaaS OQ（5-10 · pre-decision）

| # | 議題 | 裁定 | 裁定理由 |
|---|---|---|---|
| **OQ-CVA-5** | Tier 3 手動 trigger 是否納入 SaaS | ✅ **砍** | 6 個 abuse 場景（thundering herd / 無 auth / bot 誤觸 / 無 rate limit / 撞 auto batch / scope creep）|
| **OQ-CVA-6** | SaaS 頻率設計 | ✅ **layered · Tier 1 (D daily 20:00) + Tier 2 (E event-driven) + Tier 4 (confirm reuse notify)** | 各層各司其職 |
| **OQ-CVA-7** | Tier 2 abuse 防護 | ✅ rate=5min 同 sheet 3 次 · dedup by (sheet_id, record_id, 15min) · signature = Ragic Workflow secret | Reuse notify pattern |
| **OQ-CVA-8** | Tier 4 race | ✅ first-confirm-wins + Ragic status lock（confirmed_by / confirmed_at）| 避免 confirm 衝突 |
| **OQ-CVA-9** | Pilot → SaaS checkpoint | ✅ **污染率 < 20% AND ≥1 客戶願付 NT$5k/月 AND qualitative 正面**（三 AND）| 保守 · 避免確認偏誤 |
| **OQ-CVA-10** | Pilot 時效 | ✅ 3 個月（Stage 2 M6 起算）| 超過無決策 → 資源投別處 |

### 12.3 新增 OQ（v0.3 · 已裁定）

| # | 議題 | 裁定 | 裁定理由 |
|---|---|---|---|
| **OQ-CVA-11** | 兩階段 pilot 是否分開 | ✅ **是** · Stage 1 mock validation → Stage 2 real client | Lean startup 精神 · 技術/商業風險分開驗證 |
| **OQ-CVA-12** | Stage 1 mock 資料源 | ✅ 現有 `samples/` 4 檔 + AI 生成 5 edge case + 用戶手寫 optional | 混合三來源覆蓋 corner case · 現有樣本已精心設計、reuse |
| **OQ-CVA-13** | Upload storage | ✅ **Postgres text column**（pilot 檔案 <100 KB）· 不用 S3 | YAGNI · SaaS 才切 S3 |
| **OQ-CVA-14** | Analyze job 執行模式 | ✅ **immediate spawn background promise**（setImmediate + status 表輪詢）· 不做正式 queue | Render single instance 適用 · SaaS 才需 queue |
| **OQ-CVA-15** | Stage 1 → Stage 2 gate 條件 | ✅ 技術通 AND UI 好用 AND accuracy 不倒退（vs 現有 CLI）| Stage 1 目的是驗技術非商業、gate 應反映此 |

---

## 13. SOP · Stage 1 (mock) / Stage 2 (real client)

### 13.1 Stage 1 · Mock validation SOP（我方內部）

1. **新增 mock 檔** → 存 `samples-extra/<情境>.txt`
2. **登入後台** → 對話分析 → Upload → 選 tenant（twh or youcheng）
3. **等分析完成**（5 秒 poll · 通常 30-60 秒）
4. **檢查 Result 頁** · 分類覆蓋率 / 日報數 / records 數
5. **Label 頁**逐筆對錯（keyboard y/n）
6. **看 Metrics 頁** · 三大 metric 對比 CLI 版本、確認不倒退

### 13.2 Stage 2 · Real client pilot SOP（Stage 1 通後補 detail）
- Onboarding · tenant YAML · PII cleanup · cycle · feedback · metric · M8 checkpoint

### 13.3 失敗排查（Stage 1）

| 症狀 | 處置 |
|---|---|
| Upload 後 status 卡 running | 檢查 backend log · Anthropic API 錯誤 · 手動 retry |
| Result 顯示不出來 | Web console log · API 回應 shape · fallback message |
| Label 存不進去 | Signoff pattern reuse 有問題 · 檢查 label service |
| Metric 算出來很怪 | SQL view 邏輯 · 分母是否 0 |

---

## 14. 未來擴展 · 若走 SaaS（用途 C）

### 14.1 Layered 頻率設計（OQ-CVA-6 已裁定）

| Tier | 觸發 | 說明 |
|---|---|---|
| **Tier 1** | Daily batch 20:00 cron | 跑當天全群、隔天 08:00 業助上工前完成 |
| **Tier 2** | Event-driven（Ragic 動作 → 拉近 6h LINE + 抽相關對話）| 業助新增 Ragic 單 → 自動 backfill detail |
| **~~Tier 3~~** | ~~Manual button / `/歸檔`~~ | ✅ **砍**（OQ-CVA-5）|
| **Tier 4** | Confirm 通知 reuse notify | Candidate → Flex confirm 到業助群 |

### 14.2 Tier 2 abuse 防護（OQ-CVA-7）
- Rate=5min 同 sheet 3 次 · dedup by (sheet_id, record_id, 15min) · signature = Ragic Workflow secret

### 14.3 Tier 4 race（OQ-CVA-8）
- First-confirm-wins + Ragic status `confirmed_by` + `confirmed_at` lock

### 14.4 六大件補齊路線圖（若 M8 checkpoint 通過）
1. LINE webhook ingest（取代 upload）
2. 主檔 Ragic API（取代 YAML）
3. Dedup by (group_id, msg_id, run_batch_id)
4. Confirm queue Flex message（reuse notify）
5. Ragic 寫回機制
6. Prompt injection 全套 sanitize
- 估 3-6 個月工程 + 需求先 pass M8 checkpoint

---

## 15. 失效場景反思（FMEA）· Stage 1 M5 + Stage 2 M8 收尾必填（R17）

### 15.1 Stage 1 · Mock validation cycle

| # | 場景 | 影響 | Sev |
|---|---|---|---|
| M1 | Upload 超時（Anthropic API 慢 30s+）| 業助以為系統壞 | P1 |
| M2 | Result 頁輪詢太頻繁 → API 打死 | Backend load | P1 |
| M3 | Label 對象 target_id 匹配錯（classification 用 msg_id、record 用 index）| Metric 算錯 | **P0** |
| M4 | Analyze job spawn 太多 → concurrent Anthropic 呼叫 → rate limit | Pilot cycle 斷 | P1 |
| M5 | Signoff pattern reuse 不順 → label 存不進去 | Metric 全失效 | **P0** |
| M6 | Mock data 過度精心設計 → 通過但真實不通 | Stage 2 才發現失敗 | ⚠️ residual · 這正是為什麼要 Stage 2 |

### 15.2 Stage 2 · Real client cycle

| # | 場景 | 影響 | Sev |
|---|---|---|---|
| R1 | 客戶 LINE 匯出版本變 → parser 對不到 | 訊息漏 | P1 |
| R2 | 客戶檔案含極敏感 PII | 資料外洩 | P0 |
| R3 | 客戶只給 1 週資料 → metric sample size 太小 | Checkpoint 決策不可靠 | P1 |
| R4 | 客戶付費意願測不出來（免費 pilot） | M8 checkpoint 失敗 | P1 |
| R5 | 3 個月找不到願付客戶 | Timebox 到 · pivot | ⚠️ acceptable · timebox 就是為此 |

### 15.3 系統性 · 兩階段本身

| # | 場景 | 影響 | 緩解 |
|---|---|---|---|
| S1 | Stage 1 過度 focus mock、UI 為 mock 優化、真實情境 UI 不對 | Stage 2 重做 UI | Stage 1 M4 walkthrough 就要問「這個 UI 對真實客戶合理嗎」 |
| S2 | Stage 1 三個月才通、Stage 2 又三個月 = 半年 | Cash flow 壓力 | Stage 1 有 M5 checkpoint · 不通就砍不進 Stage 2 |

---

## 16. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-20 | v0.1 | 初版 DRAFT — Scope 用途 B pilot（CLI + PDF/Excel + Google Sheet label）；M0-M5、OQ-CVA-1..10、FMEA skeleton；§12 未來 SaaS 擴展 | Claude Code |
| 2026-07-20 | v0.2 | §1.3 補 Scope 選項比較與 rationale；OQ-CVA-1..10 全裁定；狀態 DRAFT → APPROVED；進 M1 | Claude Code |
| 2026-07-20 | v0.3 | **大改 · scope 從 CLI+PDF/Excel 改為 web-based · leverage 現有後台**（auth/shell/signoff/warroom/notify）· 加**兩階段 pilot**（Stage 1 mock validation + Stage 2 real client）· M1-M5 重切為 M1-M8 · 新增 OQ-CVA-11..15 · OQ-CVA-1/3 supersede · §2 加 asset inventory · §4-7 Stage 1 sub-task 詳細 · §8 Stage 2 sketch · §15 FMEA 分 Stage 1/2 | Claude Code |
