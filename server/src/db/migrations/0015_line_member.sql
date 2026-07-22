-- Migration 0015 · convo-analysis-realtime · 拉 LINE 群組成員 displayName
-- 對齊「B 方案」用戶裁定 (2026-07-22)
-- Purpose:
--   讓分析報表顯真名（王小明 vs 成員_0991d5）· 主管好追人
-- PII 責任提醒 (客戶端須告知員工):
--   台灣個資法要求「明確告知目的」· 客戶需公告員工「LINE 對話會給 aiproot 分析」

CREATE TABLE IF NOT EXISTS line_member (
  member_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  bot_id          uuid        NOT NULL REFERENCES line_bot(bot_id) ON DELETE CASCADE,
  group_id        text        NOT NULL,                      -- LINE groupId (Cxxx)
  user_id         text        NOT NULL,                      -- LINE userId (Uxxx) · PII entry
  display_name    text        NOT NULL,                      -- 從 LINE profile API 拉
  picture_url     text,                                       -- optional · profile 圖 (未來 UI 用)
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  fetch_error     text,                                       -- API 拉失敗記錯誤原因 · 保 row 供 retry
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bot_id, group_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_line_member_tenant ON line_member (tenant_id);
CREATE INDEX IF NOT EXISTS ix_line_member_user ON line_member (user_id);

-- RLS · 同 line_message pattern
ALTER TABLE line_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_member FORCE ROW LEVEL SECURITY;

CREATE POLICY line_member_tenant_isolation ON line_member
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  );

COMMENT ON TABLE line_member IS
  'LINE 群組成員 displayName cache · webhook async fetch · analysis blob 用真名';
COMMENT ON COLUMN line_member.display_name IS
  'LINE 用戶自訂 · 常是真名 · PII · 客戶需明確授權';
