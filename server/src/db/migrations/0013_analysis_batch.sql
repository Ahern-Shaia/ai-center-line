-- Migration 0013 · convo-analysis-realtime · A3 Batch 分析銜接
-- 依 docs/modules/convo-analysis-realtime.md v0.3 §6
-- OQ-CAR-6 (A) · reuse analysis_upload · 加 source / group_id / batch_date 三欄

-- ============================================================
-- 擴 analysis_upload · 讓 webhook batch 也走同一表 · 戰情室 aggregate 少改
-- ============================================================
ALTER TABLE analysis_upload
  ADD COLUMN IF NOT EXISTS source     text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'webhook', 'webhook_manual')),  -- 手動上傳 / cron 觸發 / aiproot 手動重跑
  ADD COLUMN IF NOT EXISTS group_id   text,                     -- LINE groupId (Cxxx) · manual = null
  ADD COLUMN IF NOT EXISTS batch_date date;                     -- 該 batch 對應的訊息 sent_at 日期 · manual = null

-- Batch (cron / manual by aiproot) 沒有 user context · uploaded_by 允 null
ALTER TABLE analysis_upload ALTER COLUMN uploaded_by DROP NOT NULL;

-- Batch 查詢 index (per tenant per group per day 只該有一個 upload)
CREATE INDEX IF NOT EXISTS ix_analysis_upload_batch
  ON analysis_upload (tenant_id, group_id, batch_date)
  WHERE source IN ('webhook', 'webhook_manual');

-- ============================================================
-- analysis_batch · Batch 執行狀態表 · 冪等 UNIQUE key
-- 一筆 batch = (tenant, group, date) 三元組 · 對應一 analysis_upload
-- 手動重跑會 UPDATE 舊 batch 的 upload_id → 指到新 upload (source=webhook_manual)
-- ============================================================
CREATE TABLE IF NOT EXISTS analysis_batch (
  batch_id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  group_id         text        NOT NULL,                                     -- LINE groupId (Cxxx)
  batch_date       date        NOT NULL,                                     -- 訊息 sent_at 日期 (UTC+8 · 客戶時區)
  upload_id        bigint      REFERENCES analysis_upload(id) ON DELETE SET NULL,
  status           text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'empty')),
  message_count    integer     NOT NULL DEFAULT 0,
  triggered_by     text        NOT NULL,                                     -- 'cron' | 'manual:<user_id>'
  started_at       timestamptz,
  completed_at     timestamptz,
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, group_id, batch_date)
);

CREATE INDEX IF NOT EXISTS ix_analysis_batch_tenant_date
  ON analysis_batch (tenant_id, batch_date DESC);

CREATE INDEX IF NOT EXISTS ix_analysis_batch_pending
  ON analysis_batch (status) WHERE status IN ('pending', 'running');

-- RLS
ALTER TABLE analysis_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_batch FORCE ROW LEVEL SECURITY;

CREATE POLICY analysis_batch_tenant_isolation ON analysis_batch
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  );

GRANT SELECT, INSERT, UPDATE ON analysis_batch TO app_rw;
