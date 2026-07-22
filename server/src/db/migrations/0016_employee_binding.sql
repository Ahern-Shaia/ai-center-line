-- Migration 0016 · employee-line-binding v1.0.1
-- 依 docs/modules/employee-line-binding.md 方向 8 · LIFF Zero-Config
-- 三個變動：
--   1. line_message 加 chat_context ('group'|'personal') · 區分群訊 vs 私訊
--   2. line_message 加 sender_user_id · webhook 落庫時透過 binding 對到 aiproot user
--   3. 新建 user_line_binding 表 (獨立 binding 表 · 支援 audit history)

-- ============================================================
-- 1. line_message 加 chat_context + sender_user_id
-- ============================================================
ALTER TABLE line_message
  ADD COLUMN IF NOT EXISTS chat_context text NOT NULL DEFAULT 'group'
    CHECK (chat_context IN ('group', 'personal')),
  ADD COLUMN IF NOT EXISTS sender_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL;

-- 個人日報查詢 index (per user per day)
CREATE INDEX IF NOT EXISTS ix_line_message_personal_sender_day
  ON line_message (sender_user_id, ((sent_at AT TIME ZONE 'Asia/Taipei')::date))
  WHERE chat_context = 'personal' AND sender_user_id IS NOT NULL;

-- warroom task assignee 查詢 index
CREATE INDEX IF NOT EXISTS ix_line_message_sender_user
  ON line_message (sender_user_id)
  WHERE sender_user_id IS NOT NULL;

COMMENT ON COLUMN line_message.chat_context IS
  'group=群組訊息 (line-ingest 已有的路徑) · personal=1-on-1 私訊 (個人日報素材)';
COMMENT ON COLUMN line_message.sender_user_id IS
  '對照到 aiproot users.user_id · webhook 落庫時透過 user_line_binding 查對照 · 未綁定則 null';

-- ============================================================
-- 2. user_line_binding · 綁定關係主表
-- ============================================================
CREATE TABLE IF NOT EXISTS user_line_binding (
  binding_id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  bot_id          uuid        NOT NULL REFERENCES line_bot(bot_id) ON DELETE CASCADE,
  line_user_id    text        NOT NULL,                      -- LINE UserId (Uxxx) · 對此 bot 唯一
  bound_at        timestamptz NOT NULL DEFAULT now(),
  bound_by        uuid        REFERENCES users(user_id),     -- 綁定操作者 · self_service 為 user 自己 · manual 為 aiproot admin
  binding_method  text        NOT NULL
    CHECK (binding_method IN ('liff_self_service', 'aiproot_manual')),
                                                              -- v1 只支援 liff_self_service + aiproot_manual · 未來加其他
  status          text        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  revoked_at      timestamptz,
  revoked_by      uuid        REFERENCES users(user_id),
  revoked_reason  text,                                       -- 'self_revoke' | 'aiproot_revoke' | 'user_deleted'
  metadata        jsonb,                                       -- 存 LIFF 綁定時的 line_member snapshot（audit 用）
  UNIQUE (bot_id, line_user_id)                                -- 同 bot 下 · 一個 LINE UserId 只綁一個 user
);

CREATE INDEX IF NOT EXISTS ix_user_line_binding_user ON user_line_binding (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_user_line_binding_lookup ON user_line_binding (bot_id, line_user_id) WHERE status = 'active';

-- RLS · 走 users.tenant_id 對照
ALTER TABLE user_line_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_line_binding FORCE ROW LEVEL SECURITY;

CREATE POLICY user_line_binding_tenant_isolation ON user_line_binding
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.user_id = user_line_binding.user_id
        AND (
          u.tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
          OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
        )
    )
  );

COMMENT ON TABLE user_line_binding IS
  'LINE UserId ↔ aiproot user 綁定表 · 方向 8 LIFF Zero-Config 落地 · audit history 完整';
