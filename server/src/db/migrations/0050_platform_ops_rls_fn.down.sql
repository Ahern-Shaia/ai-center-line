-- Rollback 0050 · 三個 policy 換回各自寫死的白名單（且不含 assistant）
--
-- ⚠️ 換回去之後，指派為「助理」的帳號打開「通知設定」會再次看到空清單。

DROP POLICY IF EXISTS notification_rule_aiproot ON notification_rule;
CREATE POLICY notification_rule_aiproot ON notification_rule USING (
  current_setting('app.actor_role', true) = ANY (ARRAY['aiproot_admin', 'consultant', 'system'])
);

DROP POLICY IF EXISTS notify_config_aiproot ON notify_config;
CREATE POLICY notify_config_aiproot ON notify_config USING (
  current_setting('app.actor_role', true) = ANY (ARRAY['aiproot_admin', 'consultant', 'system'])
);

DROP POLICY IF EXISTS ragic_account_aiproot ON ragic_account;
CREATE POLICY ragic_account_aiproot ON ragic_account USING (
  current_setting('app.actor_role', true) = ANY (ARRAY['aiproot_admin', 'consultant', 'system'])
);

DROP FUNCTION IF EXISTS app_is_platform_ops();
