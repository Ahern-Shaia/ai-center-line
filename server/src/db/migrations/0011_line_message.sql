-- Migration 0011 · convo-analysis-realtime · A1 訊息落庫
-- 依 docs/modules/convo-analysis-realtime.md v0.2 §4
-- 讓 line-ingest webhook 收到 group message event 時把訊息文字 / 貼圖 / 媒體參照落庫
-- tenant + group scoped RLS · aiproot_admin bypass · department_id snapshot at ingest

CREATE TABLE IF NOT EXISTS line_message (
  message_id       text        PRIMARY KEY,           -- LINE 原生 messageId · 冪等 key
  tenant_id        uuid        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  bot_id           uuid        NOT NULL REFERENCES line_bot(bot_id) ON DELETE CASCADE,
  group_id         text        NOT NULL,              -- LINE groupId (Cxxx)
  department_id    uuid        REFERENCES departments(department_id) ON DELETE SET NULL,
                                                      -- snapshot 當下的分派部門 · 之後群換部門不追溯改
  sender_line_id   text,                              -- Uxxx · null if system event
  message_type     text        NOT NULL
    CHECK (message_type IN ('text', 'sticker', 'image', 'video', 'audio', 'file', 'location', 'other')),
  text_content     text,                              -- text 型別才有
  media_id         uuid,                              -- FK 補在 0012 遷移 · 避 forward reference
  sticker_ref      jsonb,                             -- {packageId, stickerId} · sticker 才有
  sent_at          timestamptz NOT NULL,              -- 從 event.timestamp 轉 (ms epoch → tstz)
  received_at      timestamptz NOT NULL DEFAULT now(),
  raw_event        jsonb       NOT NULL,              -- 完整 event 存底 · 未來 replay / debug
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 查詢主 index · 戰情室按天 group by
CREATE INDEX IF NOT EXISTS ix_line_message_tenant_group_sent
  ON line_message (tenant_id, group_id, sent_at DESC);

-- 部門切視 · warroom aggregate 用
CREATE INDEX IF NOT EXISTS ix_line_message_dept_sent
  ON line_message (tenant_id, department_id, sent_at DESC)
  WHERE department_id IS NOT NULL;

-- 全 tenant 分析 · aiproot cost dashboard 用
CREATE INDEX IF NOT EXISTS ix_line_message_sent_at
  ON line_message (sent_at DESC);

-- RLS
ALTER TABLE line_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_message FORCE ROW LEVEL SECURITY;

CREATE POLICY line_message_tenant_isolation ON line_message
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  );
