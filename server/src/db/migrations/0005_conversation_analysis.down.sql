-- 0005_conversation_analysis.down.sql — 反向 rollback 三張表
-- 注意：DROP TABLE 會連帶 index + sequence + grant 全清

BEGIN;

DROP TABLE IF EXISTS analysis_label;
DROP TABLE IF EXISTS analysis_result;
DROP TABLE IF EXISTS analysis_upload;

COMMIT;
