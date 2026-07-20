-- 0005_conversation_analysis.sql — LINE 對話分析 pilot · 三張新表
-- 對應 docs/modules/conversation-analysis-pilot.md v0.3 §9.1
-- Pilot Stage 1 · 不掛 RLS（Stage 2 才加）
-- 冪等：可重跑

BEGIN;

-- Upload · 業助上傳的 LINE 匯出檔
CREATE TABLE IF NOT EXISTS analysis_upload (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  tenant_slug   text NOT NULL,                    -- 'twh' | 'youcheng' | 未來 tenant slug
  filename      text NOT NULL,
  raw_content   text NOT NULL,                    -- LINE 匯出原文（<500 KB · pilot 直存 Postgres）
  uploaded_by   uuid NOT NULL REFERENCES users(user_id),
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed')),
  error_message text,
  message_count integer,
  segment_count integer,
  usage_stats   jsonb
);

CREATE INDEX IF NOT EXISTS idx_analysis_upload_tenant_time
  ON analysis_upload (tenant_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_upload_pending
  ON analysis_upload (status) WHERE status IN ('pending', 'running');

-- Result · Async job 產出的分析結果（三大類 JSONB）
CREATE TABLE IF NOT EXISTS analysis_result (
  upload_id     bigint PRIMARY KEY REFERENCES analysis_upload(id) ON DELETE CASCADE,
  messages      jsonb NOT NULL DEFAULT '[]'::jsonb,
  daily_reports jsonb NOT NULL DEFAULT '[]'::jsonb,
  records       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Label · 業助標對錯（accuracy metric 來源）· pattern 抄 signoff（audit 欄位 labeled_by / labeled_at）
CREATE TABLE IF NOT EXISTS analysis_label (
  id            bigserial PRIMARY KEY,
  upload_id     bigint NOT NULL REFERENCES analysis_upload(id) ON DELETE CASCADE,
  target_type   text NOT NULL
    CHECK (target_type IN ('classification', 'daily_report', 'record')),
  target_id     text NOT NULL,                    -- classification=msgId, daily/record=index
  correct       boolean NOT NULL,
  note          text,
  labeled_by    uuid NOT NULL REFERENCES users(user_id),
  labeled_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (upload_id, target_type, target_id, labeled_by)
);

CREATE INDEX IF NOT EXISTS idx_analysis_label_upload
  ON analysis_label (upload_id, target_type);

-- 授權 app_rw
GRANT SELECT, INSERT, UPDATE ON analysis_upload TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE analysis_upload_id_seq TO app_rw;
GRANT SELECT, INSERT ON analysis_result TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON analysis_label TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE analysis_label_id_seq TO app_rw;

COMMIT;
