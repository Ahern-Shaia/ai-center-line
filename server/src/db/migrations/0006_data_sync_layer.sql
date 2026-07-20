-- 0006_data_sync_layer.sql — 中介資料層（Data Sync Layer）Stage 1 · M1
-- 對應 docs/modules/data-sync-layer.md v0.2 §4-9 · OQ-DSL-7 (3 entity) · OQ-DSL-8 (M1 開 RLS)
-- 5 表：order / customer / contact / sync_log / writeback_queue
-- 全掛 tenant_id + RLS policy（pattern 抄 0001_init.sql · tenants/tickets 同）
-- 冪等：可重跑

BEGIN;

-- === Customer · 客戶主檔（Contact 依賴此表）===
CREATE TABLE IF NOT EXISTS data_sync_customer (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  source_connector  text NOT NULL,                      -- 'ragic' | 'weyver' | 'sap' | 'manual'
  source_record_id  text NOT NULL,
  source_sheet_path text,
  name              text NOT NULL,
  code              text,                               -- 客戶編碼（SAM ABC 分級用）
  category          text,                               -- 客戶分類 e.g. 'A' 'B' 'C' 'E'
  contact_email     text,
  contact_phone     text,
  raw               jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_connector, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_data_sync_customer_tenant_name
  ON data_sync_customer (tenant_id, name);

-- === Order · 訂單（denormalized customer_name · 未來加 customer_id 關聯）===
CREATE TABLE IF NOT EXISTS data_sync_order (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  source_connector         text NOT NULL,
  source_record_id         text NOT NULL,
  source_sheet_path        text,
  order_no                 text NOT NULL,
  customer_name            text,                        -- denormalized · 快查詢
  order_date               date,
  expected_delivery_date   date,
  status                   text,
  amount                   numeric(15, 2),
  currency                 text NOT NULL DEFAULT 'TWD',
  owner_name               text,                        -- 承辦業務
  raw                      jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at                timestamptz NOT NULL DEFAULT now(),
  write_back_status        text NOT NULL DEFAULT 'synced'
    CHECK (write_back_status IN ('synced', 'pending', 'failed')),
  UNIQUE (tenant_id, source_connector, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_data_sync_order_tenant_order_no
  ON data_sync_order (tenant_id, order_no);

CREATE INDEX IF NOT EXISTS idx_data_sync_order_tenant_date
  ON data_sync_order (tenant_id, order_date DESC);

-- === Contact · 聯絡人 ===
CREATE TABLE IF NOT EXISTS data_sync_contact (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  source_connector  text NOT NULL,
  source_record_id  text NOT NULL,
  customer_id       uuid REFERENCES data_sync_customer(id) ON DELETE SET NULL,
  name              text NOT NULL,
  title             text,
  email             text,
  phone             text,
  line_id           text,                               -- LINE User ID · 未來 CRM 綁定用
  raw               jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_connector, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_data_sync_contact_tenant_customer
  ON data_sync_contact (tenant_id, customer_id);

-- === Sync log · 每次 pull/push audit ===
CREATE TABLE IF NOT EXISTS data_sync_log (
  id                bigserial PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  connector         text NOT NULL,
  operation         text NOT NULL
    CHECK (operation IN ('pull', 'push', 'backfill', 'shadow')),
  entity            text NOT NULL
    CHECK (entity IN ('order', 'customer', 'contact')),
  records_processed integer NOT NULL DEFAULT 0,
  errors            integer NOT NULL DEFAULT 0,
  latency_ms        integer NOT NULL DEFAULT 0,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_data_sync_log_tenant_started
  ON data_sync_log (tenant_id, started_at DESC);

-- === Writeback queue · Ragic 斷線緩衝（§6）===
CREATE TABLE IF NOT EXISTS data_sync_writeback_queue (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  connector     text NOT NULL,
  entity        text NOT NULL
    CHECK (entity IN ('order', 'customer', 'contact')),
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'retrying', 'synced', 'failed')),
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  synced_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_data_sync_writeback_pending
  ON data_sync_writeback_queue (next_retry_at)
  WHERE status IN ('pending', 'retrying');

-- === RLS policies · 全 5 表統一 pattern（reuse 0001_init.sql tickets pattern）===
ALTER TABLE data_sync_customer ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sync_customer FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_data_sync_customer ON data_sync_customer;
CREATE POLICY p_data_sync_customer ON data_sync_customer USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) = 'aiproot_admin'
);

ALTER TABLE data_sync_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sync_order FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_data_sync_order ON data_sync_order;
CREATE POLICY p_data_sync_order ON data_sync_order USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) = 'aiproot_admin'
);

ALTER TABLE data_sync_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sync_contact FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_data_sync_contact ON data_sync_contact;
CREATE POLICY p_data_sync_contact ON data_sync_contact USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) = 'aiproot_admin'
);

ALTER TABLE data_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sync_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_data_sync_log ON data_sync_log;
CREATE POLICY p_data_sync_log ON data_sync_log USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) = 'aiproot_admin'
);

ALTER TABLE data_sync_writeback_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sync_writeback_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_data_sync_writeback_queue ON data_sync_writeback_queue;
CREATE POLICY p_data_sync_writeback_queue ON data_sync_writeback_queue USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) = 'aiproot_admin'
);

-- === Grants ===
GRANT SELECT, INSERT, UPDATE ON data_sync_customer TO app_rw;
GRANT SELECT, INSERT, UPDATE ON data_sync_order TO app_rw;
GRANT SELECT, INSERT, UPDATE ON data_sync_contact TO app_rw;
GRANT SELECT, INSERT ON data_sync_log TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE data_sync_log_id_seq TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON data_sync_writeback_queue TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE data_sync_writeback_queue_id_seq TO app_rw;

COMMIT;
