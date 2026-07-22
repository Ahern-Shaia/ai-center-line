-- Rollback 0018 · personal-daily-report
DROP POLICY IF EXISTS personal_daily_report_scope ON personal_daily_report;
DROP INDEX IF EXISTS ix_personal_daily_report_tenant_date;
DROP INDEX IF EXISTS ix_personal_daily_report_user;
DROP TABLE IF EXISTS personal_daily_report;
