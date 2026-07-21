-- Migration 0012 · convo-analysis-realtime · A2 媒體即收即存
-- 依 docs/modules/convo-analysis-realtime.md v0.2 §5
-- LINE content URL 24hr 過期 (CLAUDE.md R13) · 收到 image/video/audio/file 立刻下載存 S3
-- storage_key = <tenant_id>/<messageId> · sha256 dedup · error 落 download_error 供手動 retry

CREATE TABLE IF NOT EXISTS line_media (
  media_id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  message_id        text        NOT NULL REFERENCES line_message(message_id) ON DELETE CASCADE,
  media_type        text        NOT NULL
    CHECK (media_type IN ('image', 'video', 'audio', 'file')),
  storage_backend   text        NOT NULL DEFAULT 's3'
    CHECK (storage_backend IN ('s3', 'render_disk', 'none')),
  storage_key       text,                              -- s3 key or disk path · null 若下載失敗
  content_type      text,                              -- image/jpeg · video/mp4 · ...
  size_bytes        bigint,
  original_filename text,                              -- file type only
  sha256            text,                              -- dedup · 也存底比對
  downloaded_at     timestamptz NOT NULL DEFAULT now(),
  download_error    text,                              -- 若下載失敗 · 存錯誤原因 · storage_key 為 null
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_line_media_tenant_downloaded
  ON line_media (tenant_id, downloaded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ix_line_media_message_id
  ON line_media (message_id);                          -- 一 message 一媒體

-- RLS
ALTER TABLE line_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_media FORCE ROW LEVEL SECURITY;

CREATE POLICY line_media_tenant_isolation ON line_media
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  );

-- 補 0011 forward reference · line_message.media_id → line_media.media_id
-- SET NULL 保訊息 row (媒體被刪不影響訊息落庫)
ALTER TABLE line_message
  ADD CONSTRAINT fk_line_message_media
  FOREIGN KEY (media_id) REFERENCES line_media(media_id) ON DELETE SET NULL;
