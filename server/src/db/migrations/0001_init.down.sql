-- 0001_init.down.sql — 回滾 M1 地基（dev 用；prod 請人工評估）
BEGIN;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS departments CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
-- 角色最後移除（若其他 DB 仍在用勿刪）
DROP ROLE IF EXISTS app_rw;
COMMIT;
