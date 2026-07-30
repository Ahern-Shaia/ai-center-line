-- Migration 0053 · 把「資料來源（master-data）」開放給 tenant_admin
-- docs/roles-permissions-matrix.md §6（用戶 2026-07-30 裁定開放）
--
-- 現況 master-data:manage 只給 aiproot_admin / consultant → 客戶總經理改不了自己的主檔。
-- 這違反「客戶方自治」。開放安全的理由：master-data.controller 用 resolveTenantId，
-- tenant_admin 被鎖在自己租戶、擋跨租戶請求（resolve-tenant-id.ts:34），無 IDOR。
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM roles r
  CROSS JOIN permissions p
 WHERE r.role_key = 'tenant_admin'
   AND r.is_system
   AND p.resource = 'master-data' AND p.action = 'manage'
ON CONFLICT DO NOTHING;
