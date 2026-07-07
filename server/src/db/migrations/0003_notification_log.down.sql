-- 0003_notification_log.down.sql
BEGIN;

DROP INDEX IF EXISTS idx_notify_log_record;
DROP INDEX IF EXISTS idx_notify_log_time;
DROP TABLE IF EXISTS notification_log;

COMMIT;
