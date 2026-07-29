-- Rollback 0049 · 把「助理」降回自訂角色
--
-- ⚠️ 降回去之前必須先確認**沒有帳號在用它**，否則那些人的權限會查不到
--    （permission.service.ts 的 `AND r.is_system = true` 會濾掉），畫面全空且不報錯。
--    先跑：SELECT count(*) FROM users WHERE role = 'assistant';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('aiproot_admin', 'consultant', 'tenant_admin', 'group_owner', 'employee')
);

UPDATE roles SET is_system = false, updated_at = now() WHERE role_key = 'assistant';
