-- 0029_notification_log_v3_status.sql — 補上 v3 pipeline 會寫入的兩種狀態
-- 冪等：可重跑
--
-- 背景：notification-hub（v3）pipeline 會寫入 skipped_event（該規則沒訂閱這種異動）
-- 與 skipped_filter（內部事件被門檻過濾），但 CHECK 停在 0004 的舊清單，
-- 導致這兩種狀態 INSERT 失敗 → HubAuditRepository 只留一行 warn、log 完全沒有紀錄。
-- 症狀：使用者回報「Ragic 改了卻沒通知」時，後台查無任何線索（最需要證據的情境反而沒證據）。

BEGIN;

ALTER TABLE notification_log
  DROP CONSTRAINT IF EXISTS notification_log_status_check;
ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_status_check
  CHECK (status IN (
    'sent', 'skipped_dedup', 'line_failed', 'invalid_body', 'invalid_secret',
    'sheet_not_allowed', 'skipped_event', 'skipped_filter'
  ));

COMMIT;
