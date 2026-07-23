-- Migration 0021 · scheduler-config 平台化
-- 對照 docs/modules/scheduler-config.md v0.2 · OQ-SCH-1..6 已裁定
--
-- 現行 scheduler 時間 / 啟用狀態 hard-code 在 @Cron decorator · 改成從 DB config 讀
-- 允 tenant_admin 改自 tenant 時間 / 啟用 / 跳過門檻 · 成本欄位(concurrency/lookback)僅 aiproot
-- OQ-SCH-1 B · platform default (tenant_id=NULL) + per-tenant override
-- OQ-SCH-2 B · tenant_admin 除成本控管其餘可改
-- OQ-SCH-3 A · 群組日誌保 default 08:00
-- OQ-SCH-4 A · 只延伸 group_batch 手動觸發到 tenant_admin
-- OQ-SCH-5 A · audit 走 stdout log (現有 audit_log 表尚未建立 · 另 module 補)
-- OQ-SCH-6 A · 停用 scheduler UI 二次 confirm (前端處理)

-- ============================================================
-- 1. scheduler_config 表
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduler_config (
  scheduler_id      text        NOT NULL,
  tenant_id         uuid        REFERENCES tenants(tenant_id) ON DELETE CASCADE,
                                                 -- NULL = platform default (fallback)
  enabled           boolean     NOT NULL DEFAULT true,
  cron_expr         text        NOT NULL,
  time_zone         text        NOT NULL DEFAULT 'Asia/Taipei',
  min_source_count  int         NOT NULL DEFAULT 0,
  lookback_days     int         NOT NULL DEFAULT 1,
  concurrency       int         NOT NULL DEFAULT 3,
  last_run_at       timestamptz,
  last_run_result   jsonb,                       -- {status, itemCount, errorMessage, ...}
  updated_by        uuid        REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduler_config_id_check CHECK (scheduler_id IN ('pdr', 'group_batch'))
);

-- (scheduler_id, tenant_id) 唯一 · NULLS NOT DISTINCT 讓 tenant_id=NULL 也算獨立值
CREATE UNIQUE INDEX IF NOT EXISTS ux_scheduler_config_id_tenant
  ON scheduler_config (scheduler_id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS ix_scheduler_config_tenant
  ON scheduler_config (tenant_id);

-- ============================================================
-- 2. Seed · platform default (tenant_id=NULL)
-- ============================================================
INSERT INTO scheduler_config (scheduler_id, tenant_id, cron_expr, time_zone, min_source_count, lookback_days, concurrency)
VALUES
  ('pdr',         NULL, '30 17 * * *', 'Asia/Taipei', 2, 1, 3),   -- OQ-SCH-3 A · PDR 17:30 default
  ('group_batch', NULL, '0 0 * * *',   'Asia/Taipei', 0, 2, 3)    -- 群組日誌 08:00 Taipei (00 UTC = 08 Taipei)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. RLS
-- ============================================================
ALTER TABLE scheduler_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_config FORCE ROW LEVEL SECURITY;

-- 讀 · 自 tenant + platform default + aiproot 全看
CREATE POLICY scheduler_config_read ON scheduler_config
  FOR SELECT
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR tenant_id IS NULL
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  );

-- 寫 · tenant_admin 只寫自 tenant · aiproot 全寫
-- 注意 · 欄位級控管（tenant_admin 不能改 concurrency / lookback_days）在 service 層 whitelist 處理
CREATE POLICY scheduler_config_write ON scheduler_config
  FOR ALL
  USING (
    (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
     AND current_setting('app.actor_role', true) = 'tenant_admin')
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'system')
  )
  WITH CHECK (
    (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
     AND current_setting('app.actor_role', true) = 'tenant_admin')
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'system')
  );

-- ============================================================
-- 4. Permission engine · 加 3 個 perm
-- ============================================================
INSERT INTO permissions (permission_id, resource, action, description, scope) VALUES
  ('scheduler-config:view', 'scheduler-config', 'view', '看定時任務設定', 'tenant'),
  ('scheduler-config:manage-tenant', 'scheduler-config', 'manage-tenant', '改自 tenant 定時任務設定（除成本欄位）', 'tenant'),
  ('scheduler-config:manage-platform', 'scheduler-config', 'manage-platform', '改 platform 全設定 + 成本欄位', 'platform')
ON CONFLICT (permission_id) DO NOTHING;

-- ============================================================
-- 5. Role → Permission mapping
-- ============================================================
-- tenant_admin 拿 view + manage-tenant
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'tenant_admin' AND r.is_system = true
  AND p.permission_id IN ('scheduler-config:view', 'scheduler-config:manage-tenant')
ON CONFLICT DO NOTHING;

-- aiproot_admin 拿全部 (view + manage-tenant + manage-platform)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'aiproot_admin' AND r.is_system = true
  AND p.permission_id IN ('scheduler-config:view', 'scheduler-config:manage-tenant', 'scheduler-config:manage-platform')
ON CONFLICT DO NOTHING;

-- consultant 拿 view only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'consultant' AND r.is_system = true
  AND p.permission_id = 'scheduler-config:view'
ON CONFLICT DO NOTHING;

-- Cache 提示 · 需 /roles/invalidate 或等 5 min TTL
