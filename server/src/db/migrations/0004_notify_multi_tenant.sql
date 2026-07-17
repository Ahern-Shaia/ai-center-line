-- 0004_notify_multi_tenant.sql — notification_log 啟用 tenant_id
-- 對應 docs/modules/notify-multi-tenant.md §7.1（OQ-NMT-5 A：型別 uuid → text 存 slug）
-- Backward compat：舊 row（tenant_id IS NULL 或 UUID）→ backfill 'twh'
-- 冪等：可重跑

BEGIN;

-- 1) 舊 row backfill 為 default tenant 'twh'（台灣福祉 v1.0 期間資料）
UPDATE notification_log SET tenant_id = NULL WHERE tenant_id IS NOT NULL;
-- （型別為 uuid 時無法塞 'twh' 字串；先 NULL 化再改型別再 backfill）

-- 2) 改型別 uuid → text
ALTER TABLE notification_log
  ALTER COLUMN tenant_id TYPE text USING tenant_id::text;

-- 3) Backfill 'twh'（舊 row + 任何殘留 NULL）
UPDATE notification_log SET tenant_id = 'twh' WHERE tenant_id IS NULL;

-- 4) 加 NOT NULL + default 'twh'（新 row 未帶 tenant_id 兜到 default）
ALTER TABLE notification_log
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT 'twh';

-- 5) 補 status CHECK constraint（加入 sheet_not_allowed）
ALTER TABLE notification_log
  DROP CONSTRAINT IF EXISTS notification_log_status_check;
ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_status_check
  CHECK (status IN (
    'sent', 'skipped_dedup', 'line_failed', 'invalid_body', 'invalid_secret', 'sheet_not_allowed'
  ));

-- 6) 查詢優化：per-tenant 錯誤率 / 訊息數
CREATE INDEX IF NOT EXISTS idx_notify_log_tenant_time
  ON notification_log (tenant_id, received_at DESC);

COMMIT;
