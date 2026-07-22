-- Rollback 0015 · line_member
DROP POLICY IF EXISTS line_member_tenant_isolation ON line_member;
DROP INDEX IF EXISTS ix_line_member_user;
DROP INDEX IF EXISTS ix_line_member_tenant;
DROP TABLE IF EXISTS line_member;
