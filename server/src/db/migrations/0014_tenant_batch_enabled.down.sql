-- Rollback 0014 · tenants.batch_enabled
ALTER TABLE tenants DROP COLUMN IF EXISTS batch_enabled;
