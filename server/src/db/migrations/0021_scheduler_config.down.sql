-- Rollback migration 0021
DELETE FROM role_permissions
WHERE permission_id IN ('scheduler-config:view', 'scheduler-config:manage-tenant', 'scheduler-config:manage-platform');

DELETE FROM permissions
WHERE permission_id IN ('scheduler-config:view', 'scheduler-config:manage-tenant', 'scheduler-config:manage-platform');

DROP TABLE IF EXISTS scheduler_config;
