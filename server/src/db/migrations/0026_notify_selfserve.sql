-- Migration 0026 · notify v2 自助設定平台（config-driven）
-- 對照 docs/modules/notify-selfserve-platform.md M1
-- ragic_account（每家 Ragic 帳號 + 加密 API key）+ notify_config（每個「表單→通知」設定）
-- + notify-config:view/manage 權限（給 aiproot_admin + consultant）
-- 全 ADD/CREATE IF NOT EXISTS · 不破壞既有資料（R1）

-- ============================================================
-- 1. ragic_account · 每家 Ragic 帳號（api key 加密 · 供 metadata/schema 與 fetch record）
-- ============================================================
CREATE TABLE IF NOT EXISTS ragic_account (
  account_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        REFERENCES tenants(tenant_id) ON DELETE CASCADE,   -- 對應客戶（nullable）
  server        text        NOT NULL DEFAULT 'www',                            -- www / ap16 / na3 / eu2
  apname        text        NOT NULL,                                          -- Ragic 帳號名（如 aitode）
  display_name  text        NOT NULL,
  api_key_enc   bytea,                                                         -- pgcrypto 加密（LINE_CONFIG_ENC_KEY）· nullable(先建後補)
  created_by    uuid        REFERENCES users(user_id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ragic_account_server_apname ON ragic_account (server, apname);

-- ============================================================
-- 2. notify_config · 每個「表單 → LINE 通知」設定
-- ============================================================
CREATE TABLE IF NOT EXISTS notify_config (
  config_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ragic_account_id uuid        NOT NULL REFERENCES ragic_account(account_id) ON DELETE CASCADE,
  tenant_id        uuid        REFERENCES tenants(tenant_id) ON DELETE CASCADE,  -- denormalized（= account.tenant_id）供 audit
  sheet_path       text        NOT NULL,                                         -- 如 /service-tickets/10
  sheet_name       text        NOT NULL,
  webhook_token    text        NOT NULL UNIQUE,                                  -- 不可猜隨機 · 綁 webhook URL /notify/webhook/<token>
  title            text,                                                         -- 自訂訊息標題（null → 用 sheet_name）
  fields           jsonb       NOT NULL DEFAULT '[]'::jsonb,                     -- [{fieldId, label, order}]
  notify_create    boolean     NOT NULL DEFAULT true,
  notify_update    boolean     NOT NULL DEFAULT true,
  notify_delete    boolean     NOT NULL DEFAULT false,
  line_group_id    text        NOT NULL,                                         -- 目標 LINE 群（token 於 M2 解析）
  enabled          boolean     NOT NULL DEFAULT true,
  created_by       uuid        REFERENCES users(user_id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_notify_config_account ON notify_config (ragic_account_id);
CREATE INDEX IF NOT EXISTS ix_notify_config_tenant  ON notify_config (tenant_id);

-- ============================================================
-- 3. RLS · aiproot-scoped（Phase 1 僅 aiproot 操作）· webhook 走 system context 讀
-- ============================================================
ALTER TABLE ragic_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE ragic_account FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ragic_account_aiproot ON ragic_account;
CREATE POLICY ragic_account_aiproot ON ragic_account
  USING (current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system'))
  WITH CHECK (current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system'));

ALTER TABLE notify_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notify_config_aiproot ON notify_config;
CREATE POLICY notify_config_aiproot ON notify_config
  USING (current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system'))
  WITH CHECK (current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system'));

-- ============================================================
-- 4. Permission engine · notify-config:view / manage
-- ============================================================
INSERT INTO permissions (permission_id, resource, action, description, scope) VALUES
  ('notify-config:view',   'notify-config', 'view',   '看通知設定列表', 'platform'),
  ('notify-config:manage', 'notify-config', 'manage', '新增/改/停用通知設定、管 Ragic 帳號金鑰', 'platform')
ON CONFLICT (permission_id) DO NOTHING;

-- aiproot_admin + consultant 皆拿 view + manage（＝ aiproot 側員工）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key IN ('aiproot_admin', 'consultant') AND r.is_system = true
  AND p.permission_id IN ('notify-config:view', 'notify-config:manage')
ON CONFLICT DO NOTHING;

-- Cache 提示：需 /roles/invalidate 或等 5 min TTL
