-- Rollback 0017 · warroom-task-board
DROP INDEX IF EXISTS ix_tickets_category;
DROP INDEX IF EXISTS ix_tickets_tenant_status;
DROP INDEX IF EXISTS ux_tickets_source_record;
ALTER TABLE tickets DROP COLUMN IF EXISTS category_id;
ALTER TABLE tickets DROP COLUMN IF EXISTS source_record_index;
ALTER TABLE tickets DROP COLUMN IF EXISTS source_upload_id;
ALTER TABLE tickets DROP COLUMN IF EXISTS due_at;
ALTER TABLE tickets DROP COLUMN IF EXISTS assignee_display_name;
DROP POLICY IF EXISTS category_registry_tenant_isolation ON category_registry;
DROP INDEX IF EXISTS ix_category_registry_tenant_active;
DROP TABLE IF EXISTS category_registry;
