-- 回滾 0052
DELETE FROM role_permissions rp
 USING permissions p
 WHERE rp.permission_id = p.permission_id
   AND p.resource = 'users' AND p.action = 'assign-department';

DELETE FROM permissions
 WHERE resource = 'users' AND action = 'assign-department';

ALTER TABLE users DROP COLUMN IF EXISTS department_assigned_at;
ALTER TABLE users DROP COLUMN IF EXISTS department_assigned_by;
ALTER TABLE users DROP COLUMN IF EXISTS department_source;
