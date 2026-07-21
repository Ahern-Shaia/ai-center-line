# convo-analysis-realtime.md — [Priority-1] LINE 即時對話分析 · webhook driven

> ✅ **狀態：APPROVED v0.2（2026-07-21）· OQ-CAR-1..7 全採建議 · 進 M1**
>
> Scope: **銜接 `line-ingest` webhook 收訊 → 存訊息 → 按時 batch → 送 `conversation-analysis` pipeline → 每日日報自動出**。不再靠人工上傳 LINE 匯出檔 · 讓工廠員工 LINE 使用習慣 100% 不變（CLAUDE.md §0 核心原則）· 系統背景自動出結果到戰情室 + 客戶簽核佇列。
>
> **依賴上游（皆已 SHIPPED）**：
> - `line-ingest` v1.0 — webhook 驗簽 · group registry · department 綁定
> - `conversation-analysis` pilot v1.0（手動上傳版）— pipeline / label / metric UI 全 reuse
> - `tenant-provisioning` v1.0 · `permission-engine` v1.0 · `signoff` v1.0
>
> 相關：[[conversation-analysis-pilot]]（手動路徑 · 本 module 是即時路徑）· [[line-ingest]]（訊息來源）
>
> 作者：Claude Code（草擬）
> 版本：v0.1（2026-07-21）

---

## 1. 目標與範圍

### 1.1 目標

1. **落訊息**：`line-ingest` webhook 收到 group message event 時，同時把訊息文字 / 貼圖 / 媒體參照落到 `line_message` 表（tenant + group scoped RLS）
2. **落媒體**：LINE content URL 有時效（CLAUDE.md R13）· 收到照片 / 影片 / 檔案時**同一 request cycle 立即下載**存 Render disk 或 S3
3. **自動 batch 分析**：定時 / 觸發時把某群某天累積的訊息 → 送 `conversation-analysis` pipeline → 產出 classifications / daily_reports / records
4. **戰情室即看**：分析結果自動綁到部門 / 群組 · 客戶登入戰情室能看**「昨天」/「今天到目前」**的日報 · 不用等業助手動上傳
5. **零操作習慣改變**：工廠員工正常在 LINE 群組發訊息 · 不需 @bot · 不需截圖 · 不需匯出

### 1.2 對應 stakeholder 訴求

| 子題 | 主要訴求 | 對應點 |
|---|---|---|
| A1 訊息落庫 | 系統要能不打擾工廠員工地收訊 | webhook 被動接收 · 全背景 · 群裡完全無感 |
| A2 媒體落地 | 照片 / 檔案要能回溯 | LINE content URL 24hr 過期 · 必即收即存 |
| A3 定時 batch | 客戶「每天早上看昨天日報」情境 | cron 每日固定時間出全 tenant 全群日報 |
| A4 戰情室綁定 | 產發署補助計畫「AI 戰情室後台」關鍵演示 | 分析結果直接餵戰情室 3 環儀 · 不再靠 mock |
| A5 補助計畫送件 | 2026-07 上旬送件需**真實運行證據** | 台灣福祉 tenant 每日出真日報 = 送件截圖素材 |

### 1.3 不做的事

- ❌ **不改 LINE 使用者體驗** — 不加 bot 回覆 / 不加確認迴圈（confirm loop 屬 [[notify-multi-tenant]] scope · 反方向：Ragic → LINE）
- ❌ **不做即時 stream 分析** — 訊息一則一則分析 context 破碎 · 成本高 · Batch 分析（按天 / 按時段）
- ❌ **不重寫 `conversation-analysis` pipeline** — 現有 M1 backend（`analyze.service.ts` / `label.service.ts`）reuse · 只多一條「來源=webhook」路徑
- ❌ **不做 media OCR / 影片語音辨識** — v1 只落**檔案二進位** + 基本 metadata · 內容抽取留 v2
- ❌ **不做重試補跑** — v1 若某天 pipeline 失敗 · aiproot_admin 手動觸發即可 · 不做自動 retry 佇列（過度工程）
- ❌ **不做 per-user 消息追蹤** — 只需 group 層級聚合 · 不需 per-userId 分析（隱私 + 法規面留 v2 討論）

---

## 2. 上游 / 既有現況走查

| 子題 | 上游現況 | Gap |
|---|---|---|
| Webhook 收訊 + 驗簽 | ✅ `line-ingest.LineWebhookService.processWebhook` 已完成 HMAC 驗簽 + group upsert | 收到 message event **文字內容目前直接丟掉** · 要加落庫 |
| 訊息落庫 schema | ❌ 無 `line_message` 表 | 全新建 · 需 tenant + group 雙層 RLS |
| 媒體下載 | ❌ 無 | LINE Messaging API `GET /message/{messageId}/content` · 全新做 · 需 access_token(來自 line_bot 表 · pgcrypto 已解) |
| 媒體儲存 | ❌ 無 | Render disk（暫）/ S3（v2）· 走 OQ-CAR-4 |
| 分析 pipeline | ✅ `conversation-analysis.AnalyzeService.analyze` 已完成 · 吃 text blob → 回 classifications/records/reports | Reuse · 只多一個 入口：從 `line_message` 拼出當天 group 對話 blob 餵進去 |
| 定時觸發 | ❌ 無 cron infra | 全新 · 走 OQ-CAR-5（cron vs 手動 vs event driven）|
| 戰情室綁定 | ✅ warroom aggregate 已能吃 analysis_upload | 要多一層「per group per day」view · 現只 per-upload |
| Analysis_upload 表 | ✅ 已有 · 手動上傳專用 | 決定 reuse or 新表（OQ-CAR-6）|
| Permission | ✅ permission-engine 有 `analysis.read` / `analysis.write` | 新加 `analysis.trigger`（手動觸發 batch）|

---

## 3. 剩餘 scope 切分

| 子題 | 內容 | 估算 |
|---|---|---|
| **A1 訊息落庫** | 擴 `line-ingest` webhook · 新 `line_message` 表 · text / sticker / media_ref 三型別 · tenant + group RLS | 0.05 mo |
| **A2 媒體即收即存** | LINE Messaging API content 下載 · Render disk mount 或 S3 client · media 表 · GC job（過期清） | 0.06 mo |
| **A3 Batch 分析銜接** | 新 `AnalysisBatchService` · 從 `line_message` 拼 blob → 呼 `AnalyzeService` · 寫 `analysis_upload` 或新表 | 0.04 mo |
| **A4 定時觸發** | Cron worker（走 OQ-CAR-5 選項）· 每 tenant × group × day 掃一次 · 冪等 | 0.03 mo |
| **A5 戰情室綁定** | Warroom aggregate 加「per group per day」view · 前端加**日期切換 + 群組切換** | 0.04 mo |
| **A6 aiproot 手動觸發 UI** | AIPROOT 管理下「對話分析歷程」頁 · 列所有 tenant × group × day batch · 可手動重跑 | 0.03 mo |
| **A7 觀測 + 成本** | Metric（訊息數 / batch 數 / token 用量）· 併入 AI 成本管理儀表 · 加 alarm | 0.02 mo |

**合計**：M1 (A1+A2) + M2 (A3+A4) + M3 (A5+A6) + M4 (A7+ FMEA) = **0.27 mo（約 5.5 週工程日）**

---

## 4. A1 · 訊息落庫

### 4.1 資料模型

```sql
-- migration 0012_line_message.sql
CREATE TABLE line_message (
  message_id       text        PRIMARY KEY,            -- LINE 原生 messageId · 冪等 key
  tenant_id        uuid        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  bot_id           uuid        NOT NULL REFERENCES line_bot(bot_id) ON DELETE CASCADE,
  group_id         text        NOT NULL,                -- LINE 原生 groupId (Cxxx)
  department_id    uuid        REFERENCES departments(dept_id),  -- 從 line_group 查來的 · 落庫時 snapshot（分派後不追溯改）
  sender_line_id   text,                                -- Uxxx · null if system event
  message_type     text        NOT NULL,                -- 'text' | 'sticker' | 'image' | 'video' | 'audio' | 'file'
  text_content     text,                                -- text 型別才有
  media_ref        uuid        REFERENCES line_media(media_id),  -- 非 text 才有 · A2 落
  sticker_ref      jsonb,                               -- {packageId, stickerId} · sticker 才有
  sent_at          timestamptz NOT NULL,                -- 從 event.timestamp 轉
  received_at      timestamptz NOT NULL DEFAULT now(),  -- 我們收到的時間
  raw_event        jsonb       NOT NULL,                -- 完整 event 存底 · 未來 replay / debug
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_line_message_tenant_group_sent ON line_message (tenant_id, group_id, sent_at DESC);
CREATE INDEX ix_line_message_dept_sent ON line_message (tenant_id, department_id, sent_at DESC) WHERE department_id IS NOT NULL;
CREATE INDEX ix_line_message_sent_at ON line_message (sent_at DESC);

ALTER TABLE line_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_message FORCE ROW LEVEL SECURITY;
CREATE POLICY p_line_message ON line_message USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) = 'aiproot_admin'
);
```

### 4.2 邏輯

擴 `line-webhook.service.ts` 現有 for-loop：

```typescript
for (const event of payload.events!) {
  const groupId = event.source?.groupId;
  if (!groupId) continue;

  // 現有 · upsert group registry
  await this.groupRepo.upsertOnEvent(tx, { botId: bot.botId, groupId, ... });

  // 新增 · 若是 message event 且群已綁 tenant · 才落訊息
  // 未綁 tenant / 未綁 department 的 group message 可先落庫但 dept_id = null（後補分派時 backfill）
  if (event.type === "message" && (event as MessageEvent).message) {
    const groupRef = await this.groupRepo.getByGroupId(tx, groupId);
    if (!groupRef?.tenantId) continue;                 // 未綁租戶不落 · 避免髒資料

    await this.messageRepo.insertOnEvent(tx, {
      messageId: (event as MessageEvent).message.id,   // LINE messageId · 冪等
      tenantId: groupRef.tenantId,
      botId: bot.botId,
      groupId,
      departmentId: groupRef.departmentId,             // snapshot at ingest
      senderLineId: event.source?.userId,
      messageType: (event as MessageEvent).message.type,
      textContent: (event as MessageEvent).message.type === "text" ? (event as MessageEvent).message.text : null,
      stickerRef: (event as MessageEvent).message.type === "sticker" ? {...} : null,
      sentAt: new Date(event.timestamp),
      rawEvent: event,
    });

    // 媒體立刻 async fire-and-forget 下載（見 A2 · 不 block webhook 200 回應）
    if (isMediaMessage(event)) {
      queueMediaDownload({...});
    }
  }
}
```

**關鍵原則**：
- `messageId` 是 LINE 給的唯一 · 直接當 PK · 重收（LINE retry）自然去重
- `department_id` snapshot at ingest · **不追溯改**（若之後群組換部門 · 歷史訊息不動 · 新訊息才用新 dept）
- `raw_event` 存底 · 未來 pipeline 升級或欄位補抽都能從這裡 replay

### 4.3 UI

無新頁面 · 訊息落庫是背景行為 · aiproot_admin 若要看 raw 訊息 · A6 的「對話分析歷程」頁下鑽 batch 詳情時可能秀部分（訊息預覽）· 但不做全訊息列表（過度）。

---

## 5. A2 · 媒體即收即存

### 5.1 資料模型

```sql
-- migration 0013_line_media.sql
CREATE TABLE line_media (
  media_id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  message_id       text        NOT NULL,                -- 對回 line_message.message_id
  media_type       text        NOT NULL,                -- 'image' | 'video' | 'audio' | 'file'
  storage_backend  text        NOT NULL,                -- 'render_disk' | 's3'
  storage_key      text        NOT NULL,                -- disk 相對 path 或 S3 key
  content_type     text,                                -- image/jpeg · video/mp4 · ...
  size_bytes       bigint,
  original_filename text,                               -- file type only
  sha256           text,                                -- 存底 dedup
  downloaded_at    timestamptz NOT NULL DEFAULT now(),
  download_error   text,                                -- 若下載失敗 · 存錯誤原因
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_line_media_tenant_downloaded ON line_media (tenant_id, downloaded_at DESC);

ALTER TABLE line_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_media FORCE ROW LEVEL SECURITY;
CREATE POLICY p_line_media ON line_media USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) = 'aiproot_admin'
);
```

### 5.2 邏輯

```typescript
// 收 webhook 內 · 若 event 是 image/video/audio/file · 立即 fire off
// 用 in-process queue（p-queue）· 併發上限 5 · 不 block webhook 200 回應
async downloadAndStore(msg: MessageEvent, bot: BotWithSecret): Promise<void> {
  const url = `https://api-data.line.me/v2/bot/message/${msg.message.id}/content`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${bot.channelAccessToken}` } });
  if (!res.ok) {
    await this.mediaRepo.insertFailed({ messageId: msg.message.id, error: `HTTP ${res.status}` });
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const storageKey = `${bot.tenantId}/${msg.message.id}`;
  await this.storage.put(storageKey, buf, { contentType: res.headers.get("content-type") });
  await this.mediaRepo.insert({...});
}
```

### 5.3 儲存後端選項

看 OQ-CAR-4。

---

## 6. A3 · Batch 分析銜接

### 6.1 邏輯

新 `AnalysisBatchService.runBatch(tenantId, groupId, dateISO)`：

```typescript
async runBatch(tenantId: string, groupId: string, dateISO: string): Promise<string> {
  // 1. 拼當天訊息 blob（時序 + sender 標記 · 對齊現有 parser 認得的 LINE 匯出格式）
  const msgs = await this.messageRepo.listByGroupDay(tx, tenantId, groupId, dateISO);
  if (msgs.length === 0) return "empty";
  const blob = renderAsLineExportFormat(msgs);   // 讓 pipeline 拿到與人工匯出檔一樣的輸入

  // 2. 呼叫既有 conversation-analysis pipeline
  const uploadId = await this.analyzeService.analyze({
    source: "webhook",
    tenantId,
    groupId,
    dateISO,
    inputText: blob,
  });

  // 3. 標記 batch record（冪等 key = tenantId + groupId + dateISO）
  await this.batchRepo.markCompleted(tx, { tenantId, groupId, dateISO, uploadId });
  return "ok";
}
```

**冪等**：同 (tenantId, groupId, dateISO) 重跑 · 覆蓋前次結果（用 `ON CONFLICT ... DO UPDATE`）· 手動觸發時 aiproot_admin 也能 replay。

### 6.2 資料結構

```sql
-- migration 0014_analysis_batch.sql
CREATE TABLE analysis_batch (
  batch_id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  group_id         text        NOT NULL,
  batch_date       date        NOT NULL,
  upload_id        integer     REFERENCES analysis_upload(id),  -- reuse or 新表 · 走 OQ-CAR-6
  status           text        NOT NULL,                        -- 'pending' | 'running' | 'completed' | 'failed'
  message_count    integer     NOT NULL DEFAULT 0,
  triggered_by     text        NOT NULL,                        -- 'cron' | 'manual:<user_id>'
  started_at       timestamptz,
  completed_at     timestamptz,
  error_message    text,
  UNIQUE (tenant_id, group_id, batch_date)
);
```

---

## 7. A4 · 定時觸發

看 OQ-CAR-5。基本設計走**每日 cron @ 20:00 UTC+8**（客戶下班前收今日 batch · 或每日 08:00 收昨日 batch）· 掃「所有已綁 tenant 的 group」· 每個 group 出一 batch。

---

## 7-bis. 企業級 cross-cutting 檢核（Mode B 必填）

### 7-bis.1 安全模型

| 攻擊面 | 緩解 | 對應實作 |
|---|---|---|
| Attacker 送假 webhook | HMAC-SHA256 驗簽（既有 line-ingest） | `LineWebhookService.processWebhook` |
| 未綁 tenant 的 group 訊息落庫 | 落庫前 check `groupRef.tenantId` · 未綁不落 | A1 邏輯 |
| Aiproot 誤看 tenant 訊息內容 | RLS `app.actor_role = 'aiproot_admin'` bypass · 但 admin UI 需明確 role check + audit log 記查詢 | permission engine `line_message.read` |
| 媒體被跨 tenant 存取 | media storage_key 前綴 tenant_id · path scoping | A2 storage key 格式 `<tenant_id>/<messageId>` |
| LINE access_token 洩漏 | pgcrypto AES-256 encrypt at rest（既有）· fetch 時解密後只保 memory | line-ingest 現有 |
| Sender line_id 隱私 | 落庫但**戰情室 UI 不顯示**（只顯示分派後匿名別號 or 部門）· PII 標記表 | A5 UI 需明確不 render |
| Content URL 洩漏 | LINE content URL 24hr 過期 · 我們立刻下載存自家 storage · access 走自家 authn | A2 storage |

Input validation：所有 webhook payload 走 zod schema · reject unknown structure；`message_id` 型別檢查 · length ≤ 100；`text_content` length ≤ LINE 上限（5000）。

### 7-bis.2 容量規劃

**假設**：台灣福祉 tenant（9 群 · 平均每群每天 100 則訊息 · 20% 有媒體 · 媒體平均 500KB）：
- **訊息**：9 × 100 × 365 = 328,500 rows/year/tenant · 每 row ≈ 1KB → **~330 MB/year/tenant**
- **媒體**：9 × 100 × 20% × 500KB × 365 = **~330 GB/year/tenant** · 相當可觀
- **10 tenant**：訊息 ~3.3 GB · 媒體 ~3.3 TB → **Render disk 撐不住 · 必上 S3**（OQ-CAR-4 定案）
- **QPS**：webhook peak 20 req/s · 均 2 req/s · Nest 單 pod 綽綽有餘
- **Critical query**：`ix_line_message_tenant_group_sent` 命中 · listByGroupDay ≤ 200 row · scan 快
- **Lock**：batch 更新 `analysis_batch` UNIQUE 衝突走 `ON CONFLICT UPDATE` · 無阻塞

### 7-bis.3 失效模式

| 路徑 | Timeout | Retry | Fallback |
|---|---|---|---|
| LINE fetch content | 15s | 1 次 · 不 block webhook | 記錯到 `download_error` · manual UI 可 retrigger |
| Anthropic API (batch) | SDK 內建 exp backoff | SDK 自動 429/5xx | batch status = failed · aiproot 手動重跑 |
| DB insert message | tx 5s | 不 retry · 冪等 messageId | webhook 200 回 · log warning |
| S3 put | 30s | 3 次 exp backoff | `download_error` 記錄 |
| Cron trigger | 每 tenant × group timeout 60s | 不 retry 當天 · 明天 cron 掃到再補（batch 有 date UNIQUE · 不重跑） | manual UI |

### 7-bis.4 觀測性

| 名稱 | 用途 |
|---|---|
| `line_message_ingested_total{tenant, group, type}` | 訊息落庫成功數 |
| `line_media_download_duration_seconds` | 媒體下載延遲 |
| `line_media_download_errors_total{reason}` | 下載失敗分類 |
| `analysis_batch_duration_seconds{tenant}` | 每 batch 分析耗時 |
| `analysis_batch_errors_total{reason}` | batch 失敗 |
| `analysis_batch_tokens_total{tenant}` | 併 AI 成本管理儀（既有 aiproot-console/cost）|
| Alert：`analysis_batch_errors_total > 5% for 1 hour` | 進 aiproot 業助 LINE 群通知 |

### 7-bis.5 資料生命週期

- **訊息**：**保 3 年**（對齊工廠常見稽核期）· 之後 archive to S3 Glacier / 刪
- **媒體**：**保 1 年**（容量壓力大）· 之後刪只保 metadata · 過期媒體 line_media.storage_key = null 但 row 留
- **PII**：`sender_line_id`（Uxxx）標 PII · 客戶方 GDPR erasure 需求 → soft delete + 匿名化 script（v2 出）
- **加密**：DB at rest（Render 內建）· S3 SSE-S3 · access_token pgcrypto column-level
- **Cross-region**：目前單 region（Render Oregon）· 客戶都在台灣 · 延遲可接受

### 7-bis.6 向後兼容 + Rollout

- **API**：新 endpoint `/analysis-batch/*` · aiproot_admin only · 不 breaking
- **Schema**：新增 3 表（line_message / line_media / analysis_batch）· 全新 · 無舊資料
- **Feature flag**：加 `LINE_INGEST_MESSAGE_STORE_ENABLED` env · default `true` · 一鍵 kill switch（訊息不再落庫 · webhook 仍走）
- **Rollout**：先 aiproot tenant 自試 · 一週後開台灣福祉 · 觀察 metric

### 7-bis.7 成本模型

以**台灣福祉 tenant**（9 群 · 平均每群每天 100 則訊息）：

| 資源 | 增量 | 月成本 |
|---|---|---|
| DB storage | +30 MB/月 | 免（Render Postgres 內含）|
| S3 storage | +27 GB/月（media） | ~$0.6 |
| Anthropic API (Opus 4.7 batch daily) | 9 群 × 30 天 × ~5000 token/batch × $75/M = **~$100/月** | $100 |
| Compute (cron worker) | 每天 5 分鐘 workload | 免（現 Render service 內）|

**Total incremental cost / tenant / month**: ~$100 · 需在 SaaS 定價**每 tenant $150/月**以上才不賠（OQ-CAR-7 討論）

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | webhook payload → line_message row 對映 · line-export format renderer · batch 冪等 | `server/tests/convo-analysis-realtime/*.test.ts` |
| Integration | webhook → DB row · batch → analyze pipeline → analysis_upload · manual trigger UI → batch | `server/tests/integration/` |
| Smoke | M4 收尾 · aiproot 送 curl 模擬 webhook · 驗全鏈路 | `docs/smoke/convo-analysis-realtime.md` |

至少 **12 個 unit tests**（訊息落庫 3 + 媒體下載 3 + batch 3 + 冪等 3）。

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 預估 | 狀態 |
|---|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED（OQ-CAR-1..7 全裁）| 0.02 mo | ✅ 2026-07-21 |
| **M1** 訊息 + 媒體落庫 | A1 + A2 · migration 0012/0013 · webhook 擴充 · 4 tests | 0.11 mo | ⏳ |
| **M2** Batch pipeline 銜接 | A3 · migration 0014 · AnalysisBatchService · 4 tests | 0.04 mo | ⏳ |
| **M3** 定時 + 手動觸發 UI | A4 + A6 · cron 或 event driven · aiproot「對話分析歷程」頁 | 0.06 mo | ⏳ |
| **M4** 戰情室綁定 + docs | A5 + A7 · warroom per-day view · 更 docs · MODULES.md → ✅ | 0.06 mo | ⏳ |
| **M5** FMEA 收尾 | 填 §12 · P0 全清才上 prod | 0.02 mo | ⏳ |

---

## 10. 開放問題（OQ-CAR-N）— ✅ 已裁定（2026-07-21 用戶「全採建議」）

| # | 議題 | 裁定 | 理由 |
|---|---|:-:|---|
| **OQ-CAR-1** | 落地策略 | **A** | 存全訊息 → 按天 batch 分析（原 CLI 路徑）· B（stream）成本 20×+ 且 context 破碎 · A 對齊 pilot pipeline · C 未來優化 |
| **OQ-CAR-2** | 媒體 v1 儲存 | **B** | AWS S3 / Cloudflare R2 · 台灣福祉一年就吃掉 Render disk · S3 開發成本 0.5 天 · 長期無憂 |
| **OQ-CAR-3** | LINE 訊息保留 | **A** | 保 3 年 · 對齊 ISO / SOC 慣例 · v2 再做 tenant 自訂 |
| **OQ-CAR-4** | 媒體保留 | **A** | 保 1 年 · 訊息文字保 3 年綽綽有餘做稽核 · 媒體僅需 1 年做「近期回溯」 |
| **OQ-CAR-5** | Batch 觸發時機 | **A** | 每天 08:00 掃昨日 · 對齊「早會看昨日」節奏 · 成本最低 · 想看今日 → 手動 trigger UI |
| **OQ-CAR-6** | Reuse 或新表 | **A** | Reuse `analysis_upload` · 加 `source` / `group_id` / `batch_date` 三欄 · 戰情室 aggregate 少改一半 |
| **OQ-CAR-7** | 商業定價 | **C** | 現階段不定價 · pilot 期只需**成本可視化**（AI 成本管理已 SHIPPED）· 定價等 3 家真客戶再定 |

**M1 動手前 · 依 §7-bis.7 記在心裡**：Anthropic Opus 4.7 batch 每 tenant 約 **$100/月** · pricing 表已就緒 · usage_stats 每 batch 記錄 · 自動出現在 AI 成本管理儀。

**M5 上 prod 前必清 3 個 P0（§12）**：
- M3 · S3 credentials 失效 alarm
- X1 · RLS 跨租戶 line_message 阻擋（unit test）
- X2 · aiproot 讀 tenant 訊息內容需 audit log + 明確路由

---

## 11. SOP — 日常操作

（M4 補齊 · 現階段草擬）

### 11.1 手動重跑某 tenant 某群某天 batch

1. aiproot_admin 登入 → 「AIPROOT 管理 → 對話分析歷程」
2. 選 tenant + group + 日期 → 「重跑」
3. 預期 30 秒內 status = completed · 戰情室該日日報更新

### 11.2 失敗模式排查

| 症狀 | 含意 | 處置 |
|---|---|---|
| batch status = failed | Anthropic API 失敗 | 看 `error_message` · 500 = API 端問題 · 隔天 cron 自然重掃 |
| media download_error 累積 | LINE access_token 過期 or bot secret 錯 | 檢查 line_bot 表 access_token · 重新 encrypt |
| 某天完全沒 batch | cron 沒起 or 全 group 無訊息 | 查 `analysis_batch` 有無 rows · 有 rows 則是空群 · 無 rows 查 cron log |
| 訊息 count = 0 但群裡有訊息 | Group 沒綁 tenant · 未落庫 | 檢查 line_group.tenant_id 是否 NULL |

### 11.3 審計查詢

```sql
-- 台灣福祉 tenant 過去 7 天訊息 volume by group
SELECT date_trunc('day', sent_at) AS day, group_id, count(*)
FROM line_message
WHERE tenant_id = '4d97eced-...'
  AND sent_at >= now() - interval '7 days'
GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC;

-- 過去 30 天所有 tenant batch 成功率
SELECT tenant_id, count(*) FILTER (WHERE status='completed')::float / count(*) AS success_rate
FROM analysis_batch
WHERE batch_date >= current_date - 30
GROUP BY tenant_id;
```

---

## 12. 失效場景反思（FMEA）— 收尾必填（R17）

（M5 收尾 · 現階段草擬骨架 · 待實作後填實際狀態）

### 12.1 Webhook 落訊息路徑

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| W1 | LINE 重送同一 event（retry） | messageId PK 冪等 · 二次 insert 走 ON CONFLICT DO NOTHING | ⏳ | P1 |
| W2 | Group 尚未綁 tenant · 訊息落 or 丟 | 丟（groupRef.tenantId null · continue）· 未來綁 tenant 後**歷史訊息不 backfill** | ⏳ | P1 |
| W3 | Group 綁 tenant 但無 department | 落庫但 department_id = null · 後補分派時歷史訊息不 backfill | ⏳ | P2 |
| W4 | 訊息內容含 emoji / 特殊 Unicode | Postgres text 已 UTF-8 · 應 OK | ⏳ | P2 |
| W5 | 訊息 > 5000 char（LINE 上限） | 應不會發生 · 但 length check + truncate 保底 | ⏳ | P2 |

### 12.2 媒體下載路徑

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| M1 | LINE content URL 24hr 過期後才觸發下載 | HTTP 410 · 記 download_error · 不 crash | ⏳ | P1 |
| M2 | 媒體 > 100MB（LINE 上限） | S3 put 應 OK · 但 memory footprint 需 stream 處理 | ⏳ | P1 |
| M3 | S3 credentials 失效 | put 失敗 · download_error 記 · alarm 觸發 | ⏳ | P0 · **要有 alarm** |
| M4 | 同 messageId 兩次觸發下載 | S3 覆寫 · sha256 dedup 檢查 · 不炸 | ⏳ | P2 |
| M5 | 併發 100 個媒體下載 | p-queue 限併發 5 · 排隊 · 不打死 process | ⏳ | P1 |

### 12.3 Batch 分析路徑

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| B1 | Anthropic API 500 全 batch fail | batch status = failed · 明天 cron 掃到同 (tenant, group, date) UNIQUE 已存 · 需 aiproot 手動重跑 | ⏳ | P1 |
| B2 | 當天群無訊息 · batch 跑 | listByGroupDay 回 [] · 早退 · status = empty · 不寫 analysis_upload | ⏳ | P2 |
| B3 | 冪等：同 (tenant, group, date) 手動重跑 | analysis_batch ON CONFLICT DO UPDATE · analysis_upload 新增新 row（source=webhook_manual · 附 replay_of） | ⏳ | P1 |
| B4 | 訊息 blob > Anthropic context 上限（200k token） | 一個群一天不應超 · 但需 pre-check length · 超則分段 | ⏳ | P1 |
| B5 | Batch 分析中 · group 換部門 | 已 snapshot department_id at ingest · 不受影響 | ⏳ | P2 |

### 12.4 Cross-tenant 隔離

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| X1 | tenant_admin 誤登他 tenant 帳號 · 看到 line_message | RLS `tenant_id = current_setting` 擋 · SELECT 0 rows | ⏳ | P0 · **要有 RLS test** |
| X2 | aiproot_admin 誤讀 tenant 訊息內容 | RLS bypass 但需 audit log 記 · 且 UI 只在 aiproot 明確路由才 render | ⏳ | P0 · **要有 audit** |
| X3 | Storage key 撞（跨 tenant） | S3 key `<tenant_id>/<messageId>` · UUID collision 幾率 0 | ⏳ | P0 |

### 12.5 部署順序

| # | 場景 | 風險 | 緩解 |
|---|---|---|---|
| D1 | Migration 0012 未跑 · code 已推 | webhook insert line_message 500 · 訊息漏收 | migration 必先（R10 人工跑）· CI 檢查欄位存在 |
| D2 | Cron 早於 M2/M3 · 但 line_message 表空 | 掃 0 rows · 全 batch = empty · 不 harm | 可先 rollout |
| D3 | S3 bucket 未建 · media 全 fail | download_error 累積 · alarm 觸發 | env `MEDIA_STORAGE_BACKEND` default 'none' · 建 bucket 後才切 's3' |

### 12.6 不在本 module scope 修的既存問題

- **PII 匿名化 / GDPR erasure**：v1 只落庫 · v2 才做 script（新 ticket [CAR-followup-1]）
- **媒體 OCR / 影片語音辨識**：v2 · 需接 Google Vision / OpenAI Whisper（新 ticket [CAR-followup-2]）
- **per-user 消息追蹤**：隱私 + 法規爭議 · 待客戶明確授權（新 ticket [CAR-followup-3]）

> **檢查點**：M5 收尾時所有 P0 是否都 ✅？否 → 回去修，不得標 SHIPPED。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-21 | v0.1 | 初版 DRAFT — 7 sub-task + OQ-CAR-1..7 + FMEA 骨架 | Claude Code |
| 2026-07-21 | v0.2 | OQ-CAR-1..7 全採建議裁定 · DRAFT → APPROVED · 進 M1 | Claude Code + user |
