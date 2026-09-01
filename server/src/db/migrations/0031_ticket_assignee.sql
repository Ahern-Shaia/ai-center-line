-- 0031_ticket_assignee.sql — 任務歸屬當責人（task-to-personal-report M1）
-- 對照 docs/modules/task-to-personal-report.md
-- 冪等：可重跑
--
-- 現況：tickets.assignee_display_name 只是 AI 從對話抽出的一段文字，
-- 系統不知道「李○○」是誰。要把任務帶進當事人的日報，必須對到系統帳號。
--
-- ⚠️ 三態設計（doc §3.3）：
--   assigned    已歸屬 —— assignee_user_id 有值，可進其日報
--   unclaimed   待認領 —— 有人名但對不到（未綁定／同名／不在名單）→ 主管手動派
--   none        無指派 —— AI 沒抽到人名
--
-- 「待認領」不是失敗狀態，是導入期的**正常主流程**：
-- 手動派發本來就是 AI 可能認錯時的確認機制；等員工綁定 LINE 後自動歸屬才逐步接手。

BEGIN;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS assignee_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS assign_status text NOT NULL DEFAULT 'none';

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_assign_status_check;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_assign_status_check
  CHECK (assign_status IN ('none', 'unclaimed', 'assigned'));

-- 誰派的、什麼時候派的 —— 手動派發要有稽核軌跡（R5）
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES users(user_id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

COMMENT ON COLUMN tickets.assignee_user_id IS
  '對到的系統帳號 · null 且 assign_status=unclaimed 表示有人名但解析不到，待主管手動派';
COMMENT ON COLUMN tickets.assign_status IS
  'none=AI 沒抽到人名 / unclaimed=有人名但對不到（導入期的正常狀態）/ assigned=已對到帳號';
COMMENT ON COLUMN tickets.assigned_by IS
  '手動派發者 · null 表示由系統自動歸屬';

-- 我的待辦：查「指派給我且尚未簽核」用
CREATE INDEX IF NOT EXISTS idx_tickets_assignee
  ON tickets (assignee_user_id, confirm_status)
  WHERE assignee_user_id IS NOT NULL;

-- 待認領清單：主管每天要掃的
CREATE INDEX IF NOT EXISTS idx_tickets_unclaimed
  ON tickets (tenant_id, created_at DESC)
  WHERE assign_status = 'unclaimed';

-- 既有資料回填：有人名的一律先進待認領（不猜對象 —— 猜錯＝把工作寫進別人的日報）
--
-- ⚠️ 這句在 prod 用 psql 直連時會**靜默更新 0 筆**：
--    tickets 的 RLS policy 是 AND 條件、沒有 actor_role 逃生門，
--    沒設 app.current_tenant 就不成立，而且不報錯。
--    → 補跑請用 docs/sop/0031_回填待認領.sql（它有正確的 SET 上下文）。
UPDATE tickets
   SET assign_status = 'unclaimed'
 WHERE assign_status = 'none'
   AND nullif(assignee_display_name, '') IS NOT NULL;

COMMIT;
