-- 0003_notification_log.sql — Ragic → LINE 通知 audit 表
-- 對應 docs/modules/notify.md §7.1
-- Phase 1 不掛 RLS（單租戶）；Phase 2 多租戶時再加 tenant_id + policy
-- 冪等：可重跑

BEGIN;

CREATE TABLE IF NOT EXISTS notification_log (
  id            bigserial PRIMARY KEY,
  request_id    uuid NOT NULL DEFAULT gen_random_uuid(),
  received_at   timestamptz NOT NULL DEFAULT now(),
  trigger       text NOT NULL CHECK (trigger IN ('save', 'button')),
  sheet_path    text NOT NULL,
  record_id     integer NOT NULL,
  status        text NOT NULL CHECK (status IN (
    'sent', 'skipped_dedup', 'line_failed', 'invalid_body', 'invalid_secret'
  )),
  line_status   integer,
  line_message  text,
  latency_ms    integer NOT NULL,
  message_text  text,
  tenant_id     uuid,
  audit         jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_notify_log_time
  ON notification_log (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_notify_log_record
  ON notification_log (sheet_path, record_id, received_at DESC);

-- 授權：app_rw 需要 INSERT + SELECT（沒有 RLS，靠 backend 層 admin-only 查詢）
GRANT SELECT, INSERT ON notification_log TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE notification_log_id_seq TO app_rw;

COMMIT;
