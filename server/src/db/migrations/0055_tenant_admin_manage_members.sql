-- Migration 0055 · 總經理自主管理成員角色與刪除（限 員工/部門主管）
-- docs/roles-permissions-matrix.md §5 · 延續 0052 MDA 的「租戶自治」路線
--
-- ── 為什麼 ────────────────────────────────────────────────
-- 改角色 / 刪除成員原本只有 users:manage（aiproot only），總經理連把員工升成
-- 部門主管都要找 aiproot。本 migration 下放這兩件事給 tenant_admin，但用權限碼
-- 與伺服器護欄鎖死範圍：只能動 員工↔部門主管，碰不到 總經理室/助理/aiproot，
-- 守住 v2「租戶不能自建/自升同級」。
--
-- ⚠️ permissions.permission_id 無 DEFAULT，自給 gen_random_uuid()（0051/0052 踩過）
-- ⚠️ permissions 無 (resource,action) 唯一約束，用 NOT EXISTS 冪等（0051/0052 踩過）

-- 1) users:assign-role · 改成員角色（伺服器限 員工↔部門主管）
INSERT INTO permissions (permission_id, resource, action, scope, description)
SELECT gen_random_uuid(), 'users', 'assign-role', 'tenant', '調整成員角色（限 員工↔部門主管，碰不到高階帳號）'
 WHERE NOT EXISTS (
   SELECT 1 FROM permissions WHERE resource = 'users' AND action = 'assign-role'
 );

-- 2) users:delete-member · 刪除自家成員（伺服器限 員工/部門主管）
INSERT INTO permissions (permission_id, resource, action, scope, description)
SELECT gen_random_uuid(), 'users', 'delete-member', 'tenant', '刪除自家成員（限 員工/部門主管，碰不到高階帳號）'
 WHERE NOT EXISTS (
   SELECT 1 FROM permissions WHERE resource = 'users' AND action = 'delete-member'
 );

-- 3) 授予 tenant_admin（aiproot 走既有 users:manage，不需這兩碼）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM roles r
  CROSS JOIN permissions p
 WHERE r.role_key = 'tenant_admin'
   AND r.is_system
   AND p.resource = 'users' AND p.action IN ('assign-role', 'delete-member')
ON CONFLICT DO NOTHING;
