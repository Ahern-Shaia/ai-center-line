-- Rollback 0013 · analysis_batch + analysis_upload 3 欄
DROP POLICY IF EXISTS analysis_batch_tenant_isolation ON analysis_batch;
DROP INDEX IF EXISTS ix_analysis_batch_pending;
DROP INDEX IF EXISTS ix_analysis_batch_tenant_date;
DROP TABLE IF EXISTS analysis_batch;

DROP INDEX IF EXISTS ix_analysis_upload_batch;
ALTER TABLE analysis_upload DROP COLUMN IF EXISTS batch_date;
ALTER TABLE analysis_upload DROP COLUMN IF EXISTS group_id;
ALTER TABLE analysis_upload DROP COLUMN IF EXISTS source;
-- Rollback uploaded_by NOT NULL · 若有 batch 產出的 row 會擋 · 需先 DELETE 那些
-- ALTER TABLE analysis_upload ALTER COLUMN uploaded_by SET NOT NULL;   -- 手動確認
