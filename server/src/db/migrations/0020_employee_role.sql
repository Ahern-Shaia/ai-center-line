-- Migration 0020 · 加 employee role · 對齊 LIFF Zero-Config 綁定的員工身份
-- 對應：LIFF 綁定建的 users · 用 employee (取代原 group_owner v1 tech debt)
-- 對照 docs/roles-permissions-matrix.md v1.1 (待補)
--
-- 3 段：
--   1. users.role CHECK constraint 加 'employee'
--   2. permission_engine seed 加 role 'employee' + 綁少量 perm (只 my-daily-report + rag/media/km/map view)
--   3. sidebar / UI 過濾（在 Shell.tsx 處理 · migration 不動）

-- ============================================================
-- 1. users.role 允 'employee'
-- ============================================================
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('aiproot_admin','consultant','tenant_admin','group_owner','employee'));

-- ============================================================
-- 2. permission_engine · 建 employee role
-- ============================================================
INSERT INTO roles (role_key, role_name, is_system, tenant_id) VALUES
  ('employee', '一般員工', true, NULL)
ON CONFLICT (role_key, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

-- employee 綁 permission · 對照矩陣：
--   ✅ personal-report:mine (自己日報)
--   ✅ rag:view / media:view / km:view / map:view (資料 · 知識查詢)
--   ✅ warroom:view (看得到戰情室 · 但 RLS 只回自己相關)
--   ❌ NOT signoff (簽核屬主管)
--   ❌ NOT warroom-tasks / warroom-daily (那是主管看的 · 員工看自己日報就夠)
--   ❌ NOT departments/users/tenant-config (管理員權限)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'employee' AND r.is_system = true
  AND p.permission_id IN (
    'personal-report:mine',
    'rag:view', 'media:view', 'km:view', 'map:view',
    'warroom:view'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. 遷移現有 LIFF 綁定建的 group_owner (有 @line.local email)  → employee
-- 條件：email 尾綴 @line.local · 表示是 LIFF 自動建的
-- ============================================================
UPDATE users
SET role = 'employee',
    role_id = (SELECT role_id FROM roles WHERE role_key = 'employee' AND is_system = true LIMIT 1)
WHERE role = 'group_owner'
  AND email LIKE '%@line.local';

-- Cache 提示 · aiproot 端需重啟 or /roles/invalidate 才生效 (5 min TTL 也會自然過)
