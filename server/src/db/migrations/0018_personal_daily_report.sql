-- Migration 0018 · personal-daily-report v1.0
-- 依 docs/modules/personal-daily-report.md
-- personal_daily_report 表 · 員工每日私訊 → AI 整理成日報
-- line_message chat_context / sender_user_id 已於 0016 (employee-binding) 完成
--
-- 生命週期：draft (AI 整理完) → confirmed (員工確認) → sent (送出給主管)
-- 冪等：UNIQUE (user_id, report_date) · cron rerun 走 UPSERT

CREATE TABLE IF NOT EXISTS personal_daily_report (
  report_id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  report_date       date        NOT NULL,
  upload_id         bigint      REFERENCES analysis_upload(id) ON DELETE SET NULL,
  ai_items          jsonb       NOT NULL DEFAULT '[]',
  final_items       jsonb,
  message_count     integer     NOT NULL DEFAULT 0,
  status            text        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'sent', 'empty', 'failed')),
  ai_generated_at   timestamptz,
  confirmed_at      timestamptz,
  sent_at           timestamptz,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, report_date)
);

CREATE INDEX IF NOT EXISTS ix_personal_daily_report_user
  ON personal_daily_report (user_id, report_date DESC);

CREATE INDEX IF NOT EXISTS ix_personal_daily_report_tenant_date
  ON personal_daily_report (tenant_id, report_date DESC, status);

-- RLS · 員工只看自己 · 主管看自己部門 · tenant_admin/aiproot 全看
ALTER TABLE personal_daily_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_daily_report FORCE ROW LEVEL SECURITY;

CREATE POLICY personal_daily_report_scope ON personal_daily_report
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    AND (
      -- 員工自己
      user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
      -- 主管看部門員工 (group_owner + department_id ownership)
      OR EXISTS (
        SELECT 1 FROM users u
        WHERE u.user_id = personal_daily_report.user_id
          AND u.department_id = nullif(current_setting('app.current_department', true), '')::uuid
      )
      -- tenant_admin 看全 tenant
      OR current_setting('app.actor_role', true) = 'tenant_admin'
    )
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  );

COMMENT ON TABLE personal_daily_report IS
  '員工每日私訊 bot → AI 整理成的日報 · pipeline reuse convo-analysis · v1 只支援 tenant.batch_enabled=true 的 tenant';
COMMENT ON COLUMN personal_daily_report.ai_items IS
  'AI pipeline 產出的原始項目陣列 · [{time, title, detail, followup}]';
COMMENT ON COLUMN personal_daily_report.final_items IS
  '員工確認後的最終項目 · null = 尚未確認 · confirmed 後可與 ai_items 不同（edit/add/delete）';
