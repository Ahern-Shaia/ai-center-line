-- Migration 0014 · convo-analysis-realtime · 加 tenants.batch_enabled 開關
-- 讓 aiproot 可 per-tenant 停用 cron 自動 batch (客戶要求中止 / 成本管控 / debug)
-- default true · 現有租戶維持原行為 · 新租戶預設開

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS batch_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN tenants.batch_enabled IS
  'convo-analysis-realtime · cron 每日 08:00 batch 是否掃該 tenant · false 時 cron 跳過 (手動仍可觸發)';
