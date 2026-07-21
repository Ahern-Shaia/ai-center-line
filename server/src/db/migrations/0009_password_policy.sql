-- Migration 0009 · tenant-provisioning M1 · password policy 落地
-- 對應 docs/modules/tenant-provisioning.md v0.1 §3

-- users 表擴充 6 columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_at   timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_expires_at   timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password  boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count    integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until          timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at         timestamptz;

-- 既有 users 遷移策略（OQ-TP-14 全採建議）：
--   1. password_updated_at ← created_at (視為當時建立時就是最新)
--   2. password_expires_at ← NULL (不強制過期 · grandfathered)
--   3. must_change_password ← true 對 tenant-scoped users · false 對 aiproot/consultant
--   4. 首次登入時強制改 · 改完進入標準 90 天週期
UPDATE users
SET password_updated_at = COALESCE(password_updated_at, created_at),
    must_change_password = CASE
      WHEN tenant_id IS NOT NULL AND password_hash IS NOT NULL THEN true
      ELSE must_change_password
    END
WHERE password_updated_at IS NULL;

-- password_history · 阻擋 reuse 最近 5 筆 (OQ-TP-4 全採建議)
CREATE TABLE IF NOT EXISTS password_history (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  set_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history (user_id, set_at DESC);

-- RLS · 每 user 只能看自己歷史（雖然應用層不 expose · 深度防禦）
ALTER TABLE password_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_history FORCE ROW LEVEL SECURITY;

CREATE POLICY password_history_owner ON password_history
  USING (
    current_setting('app.actor_role', true) IN ('aiproot_admin', 'system')
    OR user_id::text = current_setting('app.current_user_id', true)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON password_history TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE password_history_id_seq TO app_rw;

-- 修 auth 寫入 · users 表 p_users_auth 原本只 FOR SELECT · 無法在 login flow 內
-- update failed_login_count / locked_until / last_login_at · 改為 FOR ALL 讓 auth_lookup=1
-- 情境下可寫入自身欄位（withAuthLookup 一律在 auth service 內）
DROP POLICY IF EXISTS p_users_auth ON users;
CREATE POLICY p_users_auth ON users FOR ALL USING (
  current_setting('app.auth_lookup', true) = '1'
);
