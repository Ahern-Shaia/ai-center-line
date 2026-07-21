-- Migration 0010 · permission-engine M1 · RBAC extensible

-- ============================================================
-- permissions · 靜態 · code 中所有可執行 action 對照表
-- ============================================================
CREATE TABLE IF NOT EXISTS permissions (
  permission_id  text PRIMARY KEY,             -- e.g. 'line-bots:create'
  resource       text NOT NULL,
  action         text NOT NULL,
  description    text NOT NULL,
  scope          text NOT NULL DEFAULT 'tenant'
    CHECK (scope IN ('platform', 'tenant', 'department')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- roles · 4 built-in + 未來 tenant 自訂
-- ============================================================
CREATE TABLE IF NOT EXISTS roles (
  role_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key    text NOT NULL,
  role_name   text NOT NULL,
  tenant_id   uuid REFERENCES tenants(tenant_id) ON DELETE CASCADE,     -- NULL = built-in
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_role_key_tenant ON roles (role_key, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================================
-- role_permissions · join
-- ============================================================
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ============================================================
-- users 加 role_id · 保留 role text 過渡期並存 (OQ-PE-12)
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles(role_id);

-- ============================================================
-- Seed · 30+ 條 permissions
-- ============================================================
INSERT INTO permissions (permission_id, resource, action, description, scope) VALUES
  -- LINE 機器人 (aiproot 平台管理)
  ('line-bots:view', 'line-bots', 'view', '檢視 LINE 機器人', 'platform'),
  ('line-bots:create', 'line-bots', 'create', '新增 LINE 機器人', 'platform'),
  ('line-bots:update', 'line-bots', 'update', '編輯 LINE 機器人', 'platform'),
  ('line-bots:delete', 'line-bots', 'delete', '停用 LINE 機器人', 'platform'),
  ('line-groups:assign', 'line-groups', 'assign', '分派 LINE 群到部門', 'platform'),
  ('line-groups:probe', 'line-groups', 'probe', '同步 LINE 群名', 'platform'),

  -- 對話分析 (aiproot 平台管理)
  ('convo:view', 'convo', 'view', '檢視對話分析', 'platform'),
  ('convo:upload', 'convo', 'upload', '上傳新對話分析', 'platform'),
  ('convo:label', 'convo', 'label', '標註對話分析結果', 'platform'),
  ('llm-config:view', 'llm-config', 'view', '檢視 LLM 設定', 'platform'),
  ('llm-config:manage', 'llm-config', 'manage', '管理 LLM 設定', 'platform'),

  -- 租戶開通 (aiproot only)
  ('tenants:onboard', 'tenants', 'onboard', '開通新租戶', 'platform'),
  ('tenants:view', 'tenants', 'view', '檢視所有租戶', 'platform'),
  ('users:reset-password', 'users', 'reset-password', '重設他人密碼', 'platform'),
  ('users:unlock', 'users', 'unlock', '解鎖他人帳號', 'platform'),

  -- 戰情室 (tenant scope)
  ('warroom:view', 'warroom', 'view', '檢視戰情室', 'tenant'),
  ('signoff:view', 'signoff', 'view', '檢視待簽核 tickets', 'tenant'),
  ('signoff:action', 'signoff', 'action', '簽核 tickets', 'tenant'),

  -- 資料 · 知識 (tenant scope)
  ('rag:view', 'rag', 'view', '智慧檢索', 'tenant'),
  ('media:view', 'media', 'view', '素材看板', 'tenant'),
  ('km:view', 'km', 'view', '知識庫', 'tenant'),
  ('map:view', 'map', 'view', '客戶地圖', 'tenant'),

  -- 部門/成員 (aiproot 統包 · users:manage 是 aiproot 級)
  ('departments:view', 'departments', 'view', '檢視部門', 'tenant'),
  ('departments:manage', 'departments', 'manage', '管理部門 CRUD', 'platform'),
  ('users:view', 'users', 'view', '檢視使用者', 'tenant'),
  ('users:manage', 'users', 'manage', '管理使用者 CRUD', 'platform'),

  -- Tenant 設定 / audit
  ('tenant-config:view', 'tenant-config', 'view', '檢視租戶設定', 'tenant'),
  ('tenant-config:manage', 'tenant-config', 'manage', '管理租戶設定', 'tenant'),
  ('audit:view', 'audit', 'view', '檢視稽核記錄', 'tenant')
ON CONFLICT (permission_id) DO NOTHING;

-- ============================================================
-- Seed · 4 built-in roles + role_permissions
-- ============================================================
INSERT INTO roles (role_key, role_name, is_system, tenant_id) VALUES
  ('aiproot_admin', 'AIPROOT 管理員', true, NULL),
  ('consultant', '顧問', true, NULL),
  ('tenant_admin', '總經理室', true, NULL),
  ('group_owner', '群組負責人', true, NULL)
ON CONFLICT (role_key, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

-- aiproot_admin: 全部
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'aiproot_admin' AND r.is_system = true
ON CONFLICT DO NOTHING;

-- consultant: 全 view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'consultant' AND r.is_system = true
  AND p.action IN ('view')
ON CONFLICT DO NOTHING;

-- tenant_admin: 租戶內全部 (排除 platform 級)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'tenant_admin' AND r.is_system = true
  AND p.scope IN ('tenant', 'department')
ON CONFLICT DO NOTHING;

-- group_owner: warroom / signoff (view + action) + 資料·知識 view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'group_owner' AND r.is_system = true
  AND p.permission_id IN (
    'warroom:view', 'signoff:view', 'signoff:action',
    'rag:view', 'media:view', 'km:view', 'map:view'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- 遷移既有 users.role → users.role_id
-- ============================================================
UPDATE users u
SET role_id = r.role_id
FROM roles r
WHERE r.role_key = u.role AND r.is_system = true AND u.role_id IS NULL;

-- ============================================================
-- 授權 app_rw · permissions/roles 表對外唯讀 · 只 aiproot 級才寫入 (via API)
-- ============================================================
GRANT SELECT ON permissions TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON roles TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON role_permissions TO app_rw;
