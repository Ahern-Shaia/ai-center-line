-- 回滾 0053 · 收回 tenant_admin 的 master-data:manage
DELETE FROM role_permissions rp
 USING roles r, permissions p
 WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id
   AND r.role_key = 'tenant_admin'
   AND p.resource = 'master-data' AND p.action = 'manage';
