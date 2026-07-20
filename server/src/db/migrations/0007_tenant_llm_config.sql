-- 0007_tenant_llm_config.sql — LLM 設定 per-tenant
-- 對應 conversation-analysis-pilot LLM.1 · 客戶可前端配置 LLM（EEA PDF §5.9）
-- 5 providers: anthropic / openai / google / ollama / deepseek
-- apiKey 走 pgcrypto AES-256（LLM_CONFIG_ENC_KEY env · 32+ chars）
-- 冪等：可重跑

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenant_llm_config (
  tenant_id     uuid PRIMARY KEY REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  provider      text NOT NULL
    CHECK (provider IN ('anthropic','openai','google','ollama','deepseek')),
  model         text NOT NULL,
  api_key_enc   bytea NOT NULL,          -- pgp_sym_encrypt 加密的 apiKey
  base_url      text,                    -- Ollama / DeepSeek / custom · 缺則走 provider default
  temperature   real,                    -- optional · default provider 決定
  max_tokens    integer,                 -- optional
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES users(user_id)
);

-- RLS · 跟 tenants pattern 一致
ALTER TABLE tenant_llm_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_llm_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_llm_config ON tenant_llm_config;
CREATE POLICY p_tenant_llm_config ON tenant_llm_config USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) = 'aiproot_admin'
);

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_llm_config TO app_rw;

COMMIT;
