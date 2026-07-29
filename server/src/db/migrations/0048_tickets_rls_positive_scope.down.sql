-- Rollback 0048 · 把 tickets 的 RLS 換回舊的負向寫法
--
-- ⚠️ 換回去會重新打開那個洞：任何非 'group_owner' 的角色（含 employee）
--    在 DB 層都看得到全租戶所有部門的任務。只在確定 0048 造成可見範圍回歸時才用。

DROP POLICY IF EXISTS p_tickets ON tickets;
CREATE POLICY p_tickets ON tickets USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  AND (
    current_setting('app.actor_role', true) IS DISTINCT FROM 'group_owner'
    OR department_id = nullif(current_setting('app.current_department', true), '')::uuid
  )
);
