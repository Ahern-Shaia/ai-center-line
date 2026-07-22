-- Migration 0017 · warroom-task-board v1.0
-- 依 docs/modules/warroom-task-board.md
-- 三個變動：
--   1. tickets 加 4 欄 (assignee / due_at / source_upload / source_record_idx)
--   2. 新建 category_registry 表 · tenant-scoped 分類詞庫
--   3. tickets 加 category_id soft FK to category_registry

-- ============================================================
-- 1. tickets 加 4 欄
-- ============================================================
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS assignee_display_name text,
  ADD COLUMN IF NOT EXISTS due_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS source_upload_id       bigint REFERENCES analysis_upload(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_record_index    integer;

-- 冪等 UNIQUE · 同 upload + record_idx 只一筆 ticket · materializer rerun 走 UPSERT
CREATE UNIQUE INDEX IF NOT EXISTS ux_tickets_source_record
  ON tickets (source_upload_id, source_record_index)
  WHERE source_upload_id IS NOT NULL AND source_record_index IS NOT NULL;

-- Kanban 篩選 by status · tenant + status
CREATE INDEX IF NOT EXISTS ix_tickets_tenant_status
  ON tickets (tenant_id, confirm_status, created_at DESC);

COMMENT ON COLUMN tickets.assignee_display_name IS
  '從對話抽的「派給誰」· 為顯示用文字 · 未來可 JOIN line_member.display_name 對到 user';
COMMENT ON COLUMN tickets.due_at IS
  '從對話抽的截止時間 · warroom 逾時判定用';
COMMENT ON COLUMN tickets.source_upload_id IS
  '對應 analysis_upload · click drawer 展開對話 context 用';
COMMENT ON COLUMN tickets.source_record_index IS
  '對應 analysis_result.records[N] · 冪等 key';

-- ============================================================
-- 2. category_registry · tenant-scoped 分類詞庫
-- ============================================================
CREATE TABLE IF NOT EXISTS category_registry (
  category_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  category_name     text        NOT NULL,                              -- 顯示名 · e.g. "維修工單" / "客訴"
  category_slug     text        NOT NULL,                              -- pipeline JSON key · 標準化
  description       text,                                              -- aiproot / 主管註明用途
  usage_count       integer     NOT NULL DEFAULT 0,                    -- 累計被歸入次數
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at      timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        REFERENCES users(user_id),             -- null = AI 自動新增
  status            text        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'pending_review')),
  UNIQUE (tenant_id, category_slug)
);

CREATE INDEX IF NOT EXISTS ix_category_registry_tenant_active
  ON category_registry (tenant_id, status);

ALTER TABLE category_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_registry FORCE ROW LEVEL SECURITY;
CREATE POLICY category_registry_tenant_isolation ON category_registry
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  );

COMMENT ON TABLE category_registry IS
  'Tenant-scoped 分類詞庫 · pipeline 產出的新分類自動落庫 · aiproot 可 rename/archive/merge';

-- ============================================================
-- 3. tickets 加 category_id soft FK
-- ============================================================
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES category_registry(category_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_tickets_category
  ON tickets (tenant_id, category_id)
  WHERE category_id IS NOT NULL;

COMMENT ON COLUMN tickets.category_id IS
  '軟 FK 到 category_registry · category text 欄位保留為冗餘顯示 · category_id 為權威';
