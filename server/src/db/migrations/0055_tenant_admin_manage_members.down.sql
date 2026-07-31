-- Rollback 0055 · 收回 tenant_admin 的 users:assign-role / users:delete-member
DELETE FROM role_permissions rp
 USING permissions p
 WHERE rp.permission_id = p.permission_id
   AND p.resource = 'users' AND p.action IN ('assign-role', 'delete-member');

DELETE FROM permissions
 WHERE resource = 'users' AND action IN ('assign-role', 'delete-member');
