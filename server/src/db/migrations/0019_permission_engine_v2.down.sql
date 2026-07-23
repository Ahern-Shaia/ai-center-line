-- Rollback 0019 · 移除新加的 permissions
DELETE FROM role_permissions WHERE permission_id IN (
  'personal-report:mine', 'personal-report:team', 'personal-report:trigger',
  'warroom-tasks:view', 'warroom-daily:view',
  'categories:view', 'categories:manage',
  'binding:view', 'binding:aiproot-manage',
  'cost-dashboard:view', 'batch-history:view', 'batch-history:run',
  'line-groups:view',
  'users:create-group-owner',
  'departments:manage-tenant',
  'roles:view', 'roles:manage'
);
DELETE FROM permissions WHERE permission_id IN (
  'personal-report:mine', 'personal-report:team', 'personal-report:trigger',
  'warroom-tasks:view', 'warroom-daily:view',
  'categories:view', 'categories:manage',
  'binding:view', 'binding:aiproot-manage',
  'cost-dashboard:view', 'batch-history:view', 'batch-history:run',
  'line-groups:view',
  'users:create-group-owner',
  'departments:manage-tenant',
  'roles:view', 'roles:manage'
);
