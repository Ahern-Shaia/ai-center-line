-- Rollback 0011 · line_message
DROP POLICY IF EXISTS line_message_tenant_isolation ON line_message;
DROP INDEX IF EXISTS ix_line_message_sent_at;
DROP INDEX IF EXISTS ix_line_message_dept_sent;
DROP INDEX IF EXISTS ix_line_message_tenant_group_sent;
DROP TABLE IF EXISTS line_message;
