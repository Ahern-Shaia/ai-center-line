-- Migration 0033 · 任務分區：什麼才該進簽核佇列
-- 依 docs/modules/task-materialization-gate.md
--
-- 背景（prod 實測 2026-07-22～27）：
--   現有 15 張任務有 6 張（40%）不是待辦 —— 4 張是公告（開會通知、工作回覆規則）、
--   2 張已經做完（查修完、議題結案），卻都掛在「待簽核」等主管處理。
--   那 6 張 AI 沒有抽錯，抽得很準所以是 high。錯在門檻只有
--   `confidence !== 'high'` 一行，拿「抽得準不準」當「該不該追」用。
--
-- 本次把 confirm_status 明確定義成「簽核佇列狀態」，新增三個值：
--   待確認 = 中信心，等主管決定要不要收為任務（原本 64% 的中信心完全沒有出口）
--   已忽略 = 主管說不用追（重跑不可復活，否則第二次就沒人要點了）
--   存查   = 公告或已完成的事，留著可查但不需要簽核
--
-- ⚠️ 簽核率／健康度自此**只算在簽核佇列裡的票**（待簽核／已簽核／逾時警示）。
--    沒有這條，中信心票一進表就會讓 dt.every(已簽核) 永遠 false，簽核率直接掉到 0%。
--
-- tickets.status（記錄本身的 open/in_progress/resolved/info）欄位從 0001 就存在，
-- 但 materializer 從來沒寫過它（prod 15 張全是 null）—— 本次一併補寫。

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_confirm_status_check;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_confirm_status_check
  CHECK (confirm_status IN ('待簽核', '已簽核', '逾時警示', '待確認', '已忽略', '存查'));

-- 看板依佇列狀態分區 · 待確認那區會是主管每天掃的地方
CREATE INDEX IF NOT EXISTS ix_tickets_lane
  ON tickets (tenant_id, department_id, confirm_status, created_at DESC);

COMMENT ON COLUMN tickets.confirm_status IS
  '簽核佇列狀態 · 待簽核/已簽核/逾時警示 = 在佇列內（計入簽核率）；待確認/已忽略/存查 = 不計入';
COMMENT ON COLUMN tickets.status IS
  '記錄本身的狀態 open/in_progress/resolved/info · 決定它該不該進簽核佇列';
