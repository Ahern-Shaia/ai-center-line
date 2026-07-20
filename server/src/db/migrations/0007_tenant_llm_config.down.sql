-- 0007 rollback · 不 drop pgcrypto extension（別的模組可能依賴）

BEGIN;

DROP TABLE IF EXISTS tenant_llm_config;

COMMIT;
