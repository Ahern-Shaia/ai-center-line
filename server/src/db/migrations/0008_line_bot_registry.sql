-- Migration 0008 · line-ingest module
-- 建 line_bot + line_group 表 · pgcrypto AES-256 加密 access_token / channel_secret
-- 依 docs/modules/line-ingest.md v0.1 §3

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- line_bot · aiproot 廣的 LINE Messaging API bot · 綁定 tenant
-- ============================================================
CREATE TABLE IF NOT EXISTS line_bot (
  bot_id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  name                     text NOT NULL,                    -- e.g. "台灣福祉 AI 客服"
  bot_user_id              text NOT NULL,                    -- LINE bot user ID (Uxxx...) · webhook destination lookup key
  channel_id               text,                             -- LINE Console 顯示的 numeric channel ID · optional
  channel_secret_enc       bytea NOT NULL,                   -- pgcrypto AES-256
  channel_access_token_enc bytea NOT NULL,                   -- pgcrypto AES-256
  status                   text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  webhook_verified_at      timestamptz,                      -- 首次成功驗簽時間
  created_by               uuid REFERENCES users(user_id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- webhook destination lookup · 全 registry 唯一
CREATE UNIQUE INDEX IF NOT EXISTS idx_line_bot_bot_user_id ON line_bot (bot_user_id);
CREATE INDEX IF NOT EXISTS idx_line_bot_tenant ON line_bot (tenant_id);

-- RLS · tenant_admin 只看 own tenant · aiproot_admin / consultant 靠 role bypass（controller 層處理）
ALTER TABLE line_bot ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_bot FORCE ROW LEVEL SECURITY;

CREATE POLICY line_bot_tenant_isolation ON line_bot
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  );

-- ============================================================
-- line_group · webhook 收到的 groupId registry · 對應 department
-- ============================================================
CREATE TABLE IF NOT EXISTS line_group (
  group_registry_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id             uuid NOT NULL REFERENCES line_bot(bot_id) ON DELETE CASCADE,
  group_id           text NOT NULL,                          -- LINE groupId (Cxxx...)
  display_name       text,                                    -- GET /v2/bot/group/{groupId}/summary 拉
  department_id      uuid REFERENCES departments(department_id) ON DELETE SET NULL,
  analyze_enabled    boolean NOT NULL DEFAULT false,          -- Phase 2 開對話分析 · Phase 1 只儲存
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_event_at      timestamptz NOT NULL DEFAULT now(),
  event_count        integer NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'left')),
  last_event_raw     jsonb                                    -- 最新 event · debug 用
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_line_group_bot_gid ON line_group (bot_id, group_id);
CREATE INDEX IF NOT EXISTS idx_line_group_department ON line_group (department_id);
CREATE INDEX IF NOT EXISTS idx_line_group_bot ON line_group (bot_id);

-- RLS · 透過 bot_id 對應 line_bot.tenant_id · webhook 走 owner role bypass
ALTER TABLE line_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_group FORCE ROW LEVEL SECURITY;

CREATE POLICY line_group_tenant_isolation ON line_group
  USING (
    current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
    OR EXISTS (
      SELECT 1 FROM line_bot
      WHERE line_bot.bot_id = line_group.bot_id
        AND line_bot.tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    )
  );

-- 授權 app_rw 讀寫（migration owner 是 postgres · app_rw 是 runtime role）
GRANT SELECT, INSERT, UPDATE, DELETE ON line_bot TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON line_group TO app_rw;
