-- Migration 0024 · 地圖路線 provider 平台設定（aiproot 全域 · 前端可設）
-- 對照 docs/modules/attendance-location-mileage.md OQ-ATT-3 / OQ-ATT-3b（aiproot 全域）
-- provider 選 openrouteservice | google_routes；api_key 用 pgcrypto 加密（key= LINE_CONFIG_ENC_KEY）
-- 單列表：singleton PRIMARY KEY CHECK(singleton) 保證只有一列。

CREATE TABLE IF NOT EXISTS map_routing_config (
  singleton   boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
  provider    text        NOT NULL DEFAULT 'openrouteservice'
                          CHECK (provider IN ('openrouteservice', 'google_routes')),
  api_key_enc bytea,                                  -- pgp_sym_encrypt(key) · null = 未設
  updated_by  uuid        REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO map_routing_config (singleton, provider) VALUES (true, 'openrouteservice')
ON CONFLICT DO NOTHING;

ALTER TABLE map_routing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_routing_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS map_routing_config_rw ON map_routing_config;
CREATE POLICY map_routing_config_rw ON map_routing_config
  FOR ALL
  USING (current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system'))
  WITH CHECK (current_setting('app.actor_role', true) IN ('aiproot_admin', 'system'));
