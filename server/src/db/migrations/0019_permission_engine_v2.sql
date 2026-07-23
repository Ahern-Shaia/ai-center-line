-- Migration 0019 · permission-engine v2 · 對齊 docs/roles-permissions-matrix.md v1
-- 依 2026-07-23 對話裁定「開放 tenant_admin 建 group_owner + 管自 tenant depts」
--
-- 三段：
--   1. 加新 permissions (personal-report / tasks / categories / binding-audit / cost / batch)
--   2. 拆 users:manage → users:create-group-owner (tenant) + users:manage-all (platform)
--   3. 更新 built-in role_permissions 對齊矩陣

-- ============================================================
-- 1. 新加 permissions
-- ============================================================
INSERT INTO permissions (permission_id, resource, action, description, scope) VALUES
  -- 我的日報 / 主管看部門日報
  ('personal-report:mine', 'personal-report', 'mine', '檢視 / 編輯自己的日報', 'tenant'),
  ('personal-report:team', 'personal-report', 'team', '主管看部門員工日報', 'department'),
  ('personal-report:trigger', 'personal-report', 'trigger', '手動觸發個人日報生成', 'platform'),

  -- Warroom 任務看板 / 日誌
  ('warroom-tasks:view', 'warroom-tasks', 'view', '檢視任務看板 Kanban', 'tenant'),
  ('warroom-daily:view', 'warroom-daily', 'view', '檢視今日日誌', 'tenant'),

  -- 分類管理
  ('categories:view', 'categories', 'view', '檢視分類', 'tenant'),
  ('categories:manage', 'categories', 'manage', '管理分類 rename / archive', 'platform'),

  -- 綁定稽核
  ('binding:view', 'binding', 'view', '檢視 LINE 綁定記錄', 'tenant'),
  ('binding:aiproot-manage', 'binding', 'aiproot-manage', 'AIPROOT 側管理綁定 (撤銷等)', 'platform'),

  -- AI 成本 / 批次歷程 (aiproot 平台)
  ('cost-dashboard:view', 'cost-dashboard', 'view', '檢視 AI 成本管理', 'platform'),
  ('batch-history:view', 'batch-history', 'view', '檢視對話分析歷程', 'platform'),
  ('batch-history:run', 'batch-history', 'run', '手動觸發 batch 分析', 'platform'),

  -- Bot 群組列表 (tenant 可看自己 tenant 的)
  ('line-groups:view', 'line-groups', 'view', '檢視 LINE 群列表 (自 tenant)', 'tenant'),

  -- 拆 users:manage · 部門主管的 CRUD (租戶自治) vs 頂層帳號 CRUD (aiproot)
  ('users:create-group-owner', 'users', 'create-group-owner', '建立 group_owner 帳號 (自 tenant)', 'tenant'),

  -- 拆 departments:manage · 對齊矩陣 (tenant 自治)
  ('departments:manage-tenant', 'departments', 'manage-tenant', '管理自 tenant 部門 CRUD', 'tenant'),

  -- Role 管理 (aiproot 側 · Phase 2 custom role UI 用)
  ('roles:view', 'roles', 'view', '檢視所有 role', 'platform'),
  ('roles:manage', 'roles', 'manage', '建立/編輯/刪除 custom role', 'platform')
ON CONFLICT (permission_id) DO NOTHING;

-- ============================================================
-- 2. 修正舊 perm scope
--   · departments:manage 保留 platform (作為 aiproot 全 tenant 管理用) · 新加 departments:manage-tenant 給 tenant_admin
--   · users:manage 保留 platform 為 aiproot only · 新加 users:create-group-owner 給 tenant_admin
--   · line-groups:assign / probe 從 platform 改 tenant · 讓 tenant_admin 也能分派自己 tenant 的群 (aiproot 因為抓全部所以不受影響)
-- ============================================================
UPDATE permissions
SET description = '管理使用者 CRUD (全域 · aiproot only)'
WHERE permission_id = 'users:manage';

UPDATE permissions
SET description = '管理部門 CRUD (全 tenant · aiproot only)'
WHERE permission_id = 'departments:manage';

UPDATE permissions
SET scope = 'tenant',
    description = '分派 LINE 群到部門 (自 tenant)'
WHERE permission_id = 'line-groups:assign';

UPDATE permissions
SET scope = 'tenant',
    description = '同步 LINE 群名 (自 tenant)'
WHERE permission_id = 'line-groups:probe';

-- ============================================================
-- 3. 重新產生 built-in role → permission mapping · 對齊矩陣
-- ============================================================

-- aiproot_admin: 全部 · 冪等
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'aiproot_admin' AND r.is_system = true
ON CONFLICT DO NOTHING;

-- consultant: 全 view (all *:view + *:mine 讀類型)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'consultant' AND r.is_system = true
  AND p.action IN ('view', 'mine')
ON CONFLICT DO NOTHING;

-- tenant_admin: 對齊矩陣 · scope IN (tenant, department)
--   ✅ warroom:view / signoff / rag / media / km / map / warroom-tasks / warroom-daily
--   ✅ tenant-config:manage / audit:view
--   ✅ departments:manage-tenant (NEW · 開放)
--   ✅ users:create-group-owner (NEW · 開放)
--   ✅ users:view / departments:view
--   ✅ line-groups:view (自 tenant · 看 bot 群列表)
--   ✅ personal-report:mine / personal-report:team
--   ✅ categories:view / binding:view
--   ❌ NOT 開放 · users:manage / departments:manage (platform 級)
--   ❌ NOT 開放 · line-bots:* / convo:* / llm-config:* / tenants:* / cost / batch (platform)
--   ❌ NOT 開放 · roles:*
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'tenant_admin' AND r.is_system = true
  AND p.scope IN ('tenant', 'department')
ON CONFLICT DO NOTHING;

-- group_owner: 對齊矩陣 · 部門級
--   ✅ warroom:view / signoff:view / signoff:action (自 dept)
--   ✅ warroom-tasks:view / warroom-daily:view (自 dept)
--   ✅ 資料/知識 view · rag / media / km / map
--   ✅ personal-report:mine (自己)
--   ✅ personal-report:team (自 dept 員工)
--   ✅ line-groups:view (自 dept)
--   ❌ NOT 開放 · departments:manage-tenant / users:create-group-owner (tenant_admin 級)
--   ❌ NOT 開放 · tenant-config:manage / categories:view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'group_owner' AND r.is_system = true
  AND p.permission_id IN (
    'warroom:view',
    'signoff:view', 'signoff:action',
    'warroom-tasks:view', 'warroom-daily:view',
    'rag:view', 'media:view', 'km:view', 'map:view',
    'personal-report:mine', 'personal-report:team',
    'line-groups:view'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. Cache invalidation hint
-- ============================================================
-- 應用側需重啟 or 打 API POST /roles/invalidate-cache 清 5-min 快取
-- 或等 5 min 自然 TTL 過期
