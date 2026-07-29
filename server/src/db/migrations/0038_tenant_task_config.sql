-- Migration 0038 · tenant_task_config（navigation-and-capability-gating M2）
--
-- 裁定 1：「租戶只需按照自己公司性質**調整時間**」。
-- 目前那些時間是硬編的，而且**同一個 7 被寫了兩次**：
--   warroom-tasks.service.ts  GRACE_DAYS = 7      （逾時／卡住的門檻）
--   daily-report-pattern.ts   tierFor() 的 3 / 7  （提醒升級階梯）
-- 已經因此踩過一次：進欄用 `> 7×24h`、pill 用 `floor > 7`，
-- 於是 7～8 天之間的票在欄裡卻沒有 pill，看起來像 pill 壞了。
-- 兩個獨立的魔術數字遲早各自漂移，所以這次一併收進同一列設定。
--
-- OQ-NAV-7 裁定：**新開一張表**，不加在 tenants 上（tenants 已經在長欄位，
-- 而這組設定還會繼續加）。
--
-- ⚠️ 刻意**不給 SQL DEFAULT**。預設值只留在 TS 的 DEFAULT_TASK_CONFIG 一處 ——
--    兩邊各寫一次的話，改了其中一個就會出現「新租戶 7 天、舊租戶 5 天」這種
--    沒人講得出原因的差異。沒有列 = 用預設，service 負責回填。

CREATE TABLE IF NOT EXISTS tenant_task_config (
  tenant_id          uuid PRIMARY KEY REFERENCES tenants(tenant_id) ON DELETE CASCADE,

  -- 幾天沒簽核算逾時。due_at 在 prod 100% 是 null，隱含期限＝建立後這麼多天
  overdue_grace_days int NOT NULL,

  -- 提醒升級階梯 [normal 上限, aged 上限]，超過後段就不再對當事人重複、改浮到主管端
  reminder_tier_days int[] NOT NULL,

  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES users(user_id),

  -- N-5：0 → 全部立刻逾時、999 → 永遠不逾時。兩種都是把功能設成沒有作用
  CONSTRAINT tenant_task_config_grace_range
    CHECK (overdue_grace_days BETWEEN 1 AND 90),

  -- 階梯必須是遞增的兩段。寫反了（{7,3}）不會報錯但 tierFor 會永遠回同一級，
  -- 屬於「失敗跟成功長得一樣」那類，所以在 DB 擋掉
  CONSTRAINT tenant_task_config_tier_shape
    CHECK (
      array_length(reminder_tier_days, 1) = 2
      AND reminder_tier_days[1] >= 1
      AND reminder_tier_days[1] < reminder_tier_days[2]
      AND reminder_tier_days[2] <= 90
    )
);

COMMENT ON TABLE tenant_task_config IS
  '每家公司的任務時間設定 · 內容由客戶自己控制、權限由 aiproot 開放（doc §1.4 兩層模型）';

ALTER TABLE tenant_task_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_task_config FORCE ROW LEVEL SECURITY;

-- ⚠️ 讀的 policy 一定要留 actor_role 逃生門：提醒排程是以 system 身分跑的，
--    沒有 app.current_tenant。少了它會**靜默回 0 列**（不是報錯），
--    於是所有租戶都悄悄退回預設值 —— 本專案已踩過 9 次同型的坑。
CREATE POLICY tenant_task_config_read ON tenant_task_config
  FOR SELECT
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  );

CREATE POLICY tenant_task_config_write ON tenant_task_config
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
-- 權限碼（doc §4）
-- ============================================================
INSERT INTO permissions (permission_id, resource, action, description, scope) VALUES
  ('task-config:view', 'task-config', 'view', '檢視任務設定', 'tenant'),
  ('task-config:timing', 'task-config', 'timing', '改任務時間設定（寬限期／提醒階梯）', 'tenant')
ON CONFLICT (permission_id) DO NOTHING;

-- tenant_admin 拿 view + timing —— 裁定 1 的「客戶按公司性質調整時間」就是這個。
-- 對照 scheduler-config：它已經是驗證過的正確樣子（view + manage-tenant）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key IN ('aiproot_admin', 'tenant_admin') AND r.is_system = true
  AND p.permission_id IN ('task-config:view', 'task-config:timing')
ON CONFLICT DO NOTHING;

-- consultant 只讀（顧問不改客戶的營運參數）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'consultant' AND r.is_system = true
  AND p.permission_id = 'task-config:view'
ON CONFLICT DO NOTHING;

-- Cache 提示 · 需 /roles/invalidate 或等 5 min TTL
