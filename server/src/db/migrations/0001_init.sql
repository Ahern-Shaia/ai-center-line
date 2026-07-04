-- 0001_init.sql — Phase 1 M1 地基：schema + RLS + 最小權限角色
-- 執行身份：DB 擁有者 / superuser（migration）。應用連線用 app_rw（受 RLS 約束）。
-- 冪等：可重跑（IF NOT EXISTS / DROP POLICY IF EXISTS）。
-- 對應：docs/台灣福祉_系統設計文件_開發用.md §3 / §4.3（Phase 1 子集）。

BEGIN;

-- 1) 最小權限應用角色（非 superuser、非 owner → 受 RLS 約束）
-- dev 環境正常執行；Render 等 managed PG 若 owner 無 CREATEROLE 權限則跳過，改用 owner 承擔（FORCE RLS 對 owner 一樣生效）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw LOGIN PASSWORD 'app_rw_pw';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'skip CREATE ROLE app_rw (insufficient_privilege) · owner 將承擔 app_rw 角色';
END $$;

-- 2) 表（所有業務表帶 tenant_id）
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_name text NOT NULL,
  industry text,
  onboard_status text NOT NULL DEFAULT '洽談中'
    CHECK (onboard_status IN ('洽談中','測試中','正式上線','暫停')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  department_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  department_name text NOT NULL,
  display_name text,
  line_group_id text NOT NULL,
  extraction_schema text NOT NULL,
  ragic_table text NOT NULL,
  UNIQUE (tenant_id, line_group_id)
);
CREATE INDEX IF NOT EXISTS idx_departments_group ON departments (line_group_id);

CREATE TABLE IF NOT EXISTS users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(tenant_id) ON DELETE CASCADE,  -- aiproot/consultant 為 NULL
  role text NOT NULL CHECK (role IN ('aiproot_admin','consultant','tenant_admin','group_owner')),
  department_id uuid REFERENCES departments(department_id) ON DELETE SET NULL,  -- group_owner 專屬
  line_user_id text,
  email text,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id);

CREATE TABLE IF NOT EXISTS tickets (
  ticket_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
  category text,
  summary text,
  status text,
  confidence text CHECK (confidence IN ('high','medium','low')),
  confirm_status text NOT NULL DEFAULT '待簽核'
    CHECK (confirm_status IN ('待簽核','已簽核','逾時警示')),
  confirmed_by uuid REFERENCES users(user_id),
  confirmed_at timestamptz,
  proxy_by uuid REFERENCES users(user_id),
  needs_review boolean NOT NULL DEFAULT false,
  sync_status_ragic text NOT NULL DEFAULT '未同步'
    CHECK (sync_status_ragic IN ('未同步','同步中','已同步','同步失敗')),
  source_message_ids uuid[],
  message_count int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_dept_status ON tickets (tenant_id, department_id, confirm_status, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_conf ON tickets (tenant_id, confidence, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id uuid,
  actor_role text,
  action text NOT NULL,
  tenant_id uuid,
  target_id uuid,
  result text NOT NULL DEFAULT 'allowed' CHECK (result IN ('allowed','denied')),
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log (tenant_id, created_at);

-- 3) 授權 app_rw（DML）；不給 DDL/owner 權限（app_rw 不存在時全 DO 塊跳過）
DO $$
BEGIN
  GRANT USAGE ON SCHEMA public TO app_rw;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
  -- audit_log 僅可寫入與查詢，不可竄改
  REVOKE UPDATE, DELETE ON audit_log FROM app_rw;
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'skip GRANT app_rw · Render 環境用 owner 執行 · FORCE RLS 已保安全性';
END $$;

-- 4) RLS：ENABLE + FORCE（FORCE 讓 owner 也受約束，避免測試/工具用 owner 連線時 bypass）
--    以 session 變數為準：app.current_tenant / app.actor_role / app.current_department
--    nullif(...,'')::uuid 讓「未設定/空字串」安全落為 NULL（拒絕），不會 cast 例外。

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenants ON tenants;
CREATE POLICY p_tenants ON tenants USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) = 'aiproot_admin'
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_departments ON departments;
CREATE POLICY p_departments ON departments USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_users ON users;
CREATE POLICY p_users ON users USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) = 'aiproot_admin'
);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tickets ON tickets;
CREATE POLICY p_tickets ON tickets USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  AND (
    current_setting('app.actor_role', true) IS DISTINCT FROM 'group_owner'
    OR department_id = nullif(current_setting('app.current_department', true), '')::uuid
  )
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_audit ON audit_log;
CREATE POLICY p_audit ON audit_log USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) = 'aiproot_admin'
);

-- 登入查詢：auth 服務以 app.auth_lookup='1' 跨租戶讀 users（僅 SELECT），供 /auth/login 找帳號。
-- 與 p_users（租戶範圍）為 OR 關係；寫入仍受 p_users 租戶約束。
DROP POLICY IF EXISTS p_users_auth ON users;
CREATE POLICY p_users_auth ON users FOR SELECT USING (
  current_setting('app.auth_lookup', true) = '1'
);

COMMIT;
