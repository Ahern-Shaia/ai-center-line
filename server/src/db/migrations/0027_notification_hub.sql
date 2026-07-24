-- Migration 0027 · 通知中心（notify v3）· 來源/管道可插拔
-- 對照 docs/modules/notification-hub.md M1
-- notify_config（Ragic 專屬）→ notification_rule（來源無關）· 一次性搬 · 保留 webhook_token 不失效
-- 全 CREATE/ADD IF NOT EXISTS · 不破壞既有資料（R1）

-- ============================================================
-- 1. notification_rule · 通知規則（來源 + 過濾 → 模板 → 管道）
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_rule (
  rule_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  name           text        NOT NULL,
  enabled        boolean     NOT NULL DEFAULT true,

  -- 來源（可插拔）
  source_type    text        NOT NULL
                             CHECK (source_type IN ('ragic_form', 'internal_event', 'schedule')),
  source_config  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- ragic_form     → {ragicAccountId, sheetPath, sheetName, events:{create,update,delete}}
  -- internal_event → {eventType, filters:[{path,op,value}]}

  -- webhook 入口（僅 ragic_form 用）· 保留舊 token → 已貼進 Ragic 的 URL 不失效
  webhook_token  text        UNIQUE,

  -- 模板（通用 · {label,path} 清單 · OQ-NH-5）
  template       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- {title, items:[{label, path, order}]}

  -- 管道（可插拔）
  channel_type   text        NOT NULL
                             CHECK (channel_type IN ('line_group', 'line_user', 'email', 'in_app')),
  channel_target text,       -- group_id / line user id / email · in_app 為 null

  created_by     uuid        REFERENCES users(user_id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_notification_rule_tenant ON notification_rule (tenant_id);
CREATE INDEX IF NOT EXISTS ix_notification_rule_source ON notification_rule (source_type, enabled);

-- RLS · aiproot-scoped（比照 notify_config）· webhook 走 system context
ALTER TABLE notification_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rule FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_rule_aiproot ON notification_rule;
CREATE POLICY notification_rule_aiproot ON notification_rule
  USING (current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system'))
  WITH CHECK (current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system'));

-- ============================================================
-- 2. notification_log · 加 v3 欄位（沿用同一 audit 表）
-- ============================================================
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS rule_id     uuid;
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS channel     text;

-- ============================================================
-- 3. 一次性遷移 · notify_config → notification_rule（OQ-NH-4）
--    fields[{fieldId,label,order}] → template.items[{path,label,order}]
--    保留 webhook_token；重跑安全（以 webhook_token 判重）
-- ============================================================
INSERT INTO notification_rule
  (tenant_id, name, enabled, source_type, source_config, webhook_token, template, channel_type, channel_target, created_by, created_at)
SELECT
  c.tenant_id,
  c.sheet_name,
  c.enabled,
  'ragic_form',
  jsonb_build_object(
    'ragicAccountId', c.ragic_account_id,
    'sheetPath',      c.sheet_path,
    'sheetName',      c.sheet_name,
    'events',         jsonb_build_object('create', c.notify_create, 'update', c.notify_update, 'delete', c.notify_delete)
  ),
  c.webhook_token,
  jsonb_build_object(
    'title', COALESCE(c.title, c.sheet_name),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'path',  (f->>'fieldId'),
               'label',  f->>'label',
               'order', (f->>'order')::int
             ) ORDER BY (f->>'order')::int)
      FROM jsonb_array_elements(c.fields) AS f
    ), '[]'::jsonb)
  ),
  'line_group',
  c.line_group_id,
  c.created_by,
  c.created_at
FROM notify_config c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_rule r WHERE r.webhook_token = c.webhook_token
);

-- 註：notify_config / ragic_account 保留不刪
--   · ragic_account 續用（ragic_form 來源引用其 API key）
--   · notify_config 留作遷移對帳；確認 v3 穩定後另開 migration 清除
