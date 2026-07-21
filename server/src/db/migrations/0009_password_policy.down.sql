DROP TABLE IF EXISTS password_history;
ALTER TABLE users DROP COLUMN IF EXISTS password_updated_at;
ALTER TABLE users DROP COLUMN IF EXISTS password_expires_at;
ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;
ALTER TABLE users DROP COLUMN IF EXISTS failed_login_count;
ALTER TABLE users DROP COLUMN IF EXISTS locked_until;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
