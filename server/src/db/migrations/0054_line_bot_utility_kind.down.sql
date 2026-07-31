-- Rollback 0054 · 移除 line_bot.kind + 恢復 tenant_id NOT NULL
-- ⚠️ 若已存在 utility bot（tenant_id 為 NULL），恢復 NOT NULL 會失敗；
--    需先刪除或指派 tenant_id 才能回滾。

ALTER TABLE line_bot DROP CONSTRAINT IF EXISTS line_bot_tenant_required_for_analysis;
ALTER TABLE line_bot ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE line_bot DROP COLUMN IF EXISTS kind;
