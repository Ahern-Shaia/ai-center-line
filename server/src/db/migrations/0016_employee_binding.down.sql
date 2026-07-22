-- Rollback 0016 · employee-line-binding
DROP POLICY IF EXISTS user_line_binding_tenant_isolation ON user_line_binding;
DROP INDEX IF EXISTS ix_user_line_binding_lookup;
DROP INDEX IF EXISTS ix_user_line_binding_user;
DROP TABLE IF EXISTS user_line_binding;

DROP INDEX IF EXISTS ix_line_message_sender_user;
DROP INDEX IF EXISTS ix_line_message_personal_sender_day;
ALTER TABLE line_message DROP COLUMN IF EXISTS sender_user_id;
ALTER TABLE line_message DROP COLUMN IF EXISTS chat_context;
