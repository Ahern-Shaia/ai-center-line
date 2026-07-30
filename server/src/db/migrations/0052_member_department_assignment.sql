-- Migration 0052 · MDA：總經理自主分配成員部門
-- docs/modules/member-department-assignment.md · docs/roles-permissions-matrix.md §5
--
-- ── 為什麼 ────────────────────────────────────────────────
-- 改成員部門的端點 PATCH /users/:id 要 users:manage（只給 aiproot_admin），
-- 所以總經理現在完全不能分配成員部門，員工被自動推導錯了也只能找 aiproot。
-- 這違反「客戶方自治」。本 migration 下放「只改部門」這一件事給 tenant_admin。
--
-- ── 站在巨人肩膀上 ────────────────────────────────────────
-- 部門是「資料範圍屬性」不是「權限」→ 改它不構成提權，可安全下放（K8s/custom-roles）。
-- 加 department_source{auto,manual}：自動推導與手動指派並存、手動優先永不被覆寫
-- （Okta Group Rules / Azure 動態vs指派的做法）。

-- 1) 來源標記 + 審計欄（Okta/Azure：手動優先 + 透明度）
--    既有列全部落 'auto'（＝現行行為，都是綁定時自動推導的）
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department_source text NOT NULL DEFAULT 'auto'
    CHECK (department_source IN ('auto', 'manual'));
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department_assigned_by uuid REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department_assigned_at timestamptz;

-- 2) 新權限碼 users:assign-department（只改部門這個屬性，不碰角色/刪除）
-- ⚠️ permissions.permission_id 無 DEFAULT，要自給 gen_random_uuid()（0051 踩過）
-- ⚠️ permissions 無 (resource,action) 唯一約束，用 NOT EXISTS 表達冪等（0051 踩過）
INSERT INTO permissions (permission_id, resource, action, scope, description)
SELECT gen_random_uuid(), 'users', 'assign-department', 'tenant', '分配成員的所屬部門（只改部門，不碰角色/刪除）'
 WHERE NOT EXISTS (
   SELECT 1 FROM permissions WHERE resource = 'users' AND action = 'assign-department'
 );

-- 3) 授予 aiproot_admin + tenant_admin
--    （改角色/刪除仍是 users:manage = aiproot only，本 migration 不動）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM roles r
  CROSS JOIN permissions p
 WHERE r.role_key IN ('aiproot_admin', 'tenant_admin')
   AND r.is_system
   AND p.resource = 'users' AND p.action = 'assign-department'
ON CONFLICT DO NOTHING;
