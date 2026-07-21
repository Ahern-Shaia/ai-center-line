-- Rollback 0012 · line_media
ALTER TABLE line_message DROP CONSTRAINT IF EXISTS fk_line_message_media;
DROP POLICY IF EXISTS line_media_tenant_isolation ON line_media;
DROP INDEX IF EXISTS ix_line_media_message_id;
DROP INDEX IF EXISTS ix_line_media_tenant_downloaded;
DROP TABLE IF EXISTS line_media;
