-- Rollback 0020
-- 先把 employee 遷回 group_owner (資料安全 · 免 CHECK 失敗)
UPDATE users SET role = 'group_owner' WHERE role = 'employee';

DELETE FROM role_permissions
WHERE role_id IN (SELECT role_id FROM roles WHERE role_key = 'employee' AND is_system = true);
DELETE FROM roles WHERE role_key = 'employee' AND is_system = true;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('aiproot_admin','consultant','tenant_admin','group_owner'));
