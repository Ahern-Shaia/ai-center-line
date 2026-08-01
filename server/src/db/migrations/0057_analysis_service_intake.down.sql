-- 0057 down — 移除 analysis_result.service_intake 欄位
-- ⚠️ 破壞性：會丟掉已抽的報修單資料。僅在確定要回滾時執行。

BEGIN;

ALTER TABLE analysis_result
  DROP COLUMN IF EXISTS service_intake;

COMMIT;
