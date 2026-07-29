-- Migration 0045 · 人工指派後通知當事人（task-assign-notify M1/M3）
--
-- 用戶裁定 OQ-TAN-1..8 全採建議。這是本產品**第一個同步的主動推播** ——
-- 現行系統刻意只在對方先開口時用 reply token（免費），指派通知是我們決定要打擾他。
-- 界線寫在 doc §2.2：「有人對他做了決定」可推、「狀態廣播／系統定時提醒」不可推。

-- ── 已經通知過誰（FMEA A-4 / A-6）──────────────────────────────
-- A-4：主管反覆改指派，當事人被連續私訊 → 同一張票對同一人只推第一次
-- A-6：取消指派時，只通知**原本推過**的那個人（沒推過就不必說「不用做了」）
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS assign_notified_at      timestamptz,
  ADD COLUMN IF NOT EXISTS assign_notified_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL;

COMMENT ON COLUMN tickets.assign_notified_user_id IS
  '上一次成功推播通知的對象 · 用來避免重複打擾（A-4）與判斷取消時該通知誰（A-6）';

-- ── 客戶可以關掉（OQ-TAN-4）───────────────────────────────────
-- ⚠️ 刻意**可為 NULL**，NULL = 沿用預設。
--    tenant_task_config 的原則是「預設值只留在 TS 的 DEFAULT_TASK_CONFIG 一處」——
--    給 SQL DEFAULT 的話會出現「新租戶 true、舊租戶 NULL」這種沒人講得出原因的差異。
ALTER TABLE tenant_task_config
  ADD COLUMN IF NOT EXISTS assign_notify_enabled boolean;

COMMENT ON COLUMN tenant_task_config.assign_notify_enabled IS
  '指派後要不要私訊當事人 · NULL = 沿用 DEFAULT_TASK_CONFIG（預設開）';
