-- 0004_notify_multi_tenant.down.sql — rollback tenant_id 啟用
-- 注意：若 rollback 時已有非 UUID 值（e.g. 'xianyong'），無法轉回 uuid，會失敗
--       需先 DELETE FROM notification_log WHERE tenant_id != 'twh' 或 SET tenant_id = NULL
-- 保守做法：先允許 NULL、drop constraint、退型別；tenant_id 資料視需要人工處理

BEGIN;

DROP INDEX IF EXISTS idx_notify_log_tenant_time;

ALTER TABLE notification_log
  DROP CONSTRAINT IF EXISTS notification_log_status_check;
ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_status_check
  CHECK (status IN (
    'sent', 'skipped_dedup', 'line_failed', 'invalid_body', 'invalid_secret'
  ));

ALTER TABLE notification_log
  ALTER COLUMN tenant_id DROP NOT NULL,
  ALTER COLUMN tenant_id DROP DEFAULT;

-- 型別退回 uuid：非 UUID 值會 fail；先手動處理再跑本 down script
ALTER TABLE notification_log
  ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;

COMMIT;
