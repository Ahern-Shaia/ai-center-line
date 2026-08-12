-- 0062_platform_ops_read_bots.sql — 平台維運角色可「讀」所有 bot / 群組 / 租戶
-- 冪等：可重跑
--
-- 背景（2026-08-12）：
-- 通知設定精靈改成「先選機器人 → 再選該機器人的群組」（0061）之後，
-- 以 assistant 身分登入的 aiproot 同仁，下拉只看得到自己租戶那一支 bot。
--
-- 原因：line_bot / line_group / tenants 的逃生門是
--   aiproot_admin / consultant / system —— **獨缺 assistant**，
-- 而 assistant 正是「協助管通知設定與 Ragic 帳號」那個角色（0050）。
-- notification_rule / notify_config / ragic_account 三張表早就改用 app_is_platform_ops()
-- （含 assistant），只有這三張沒跟上 → 同一個人在同一頁，有的資料看得到有的看不到。
--
-- ⚠️ 這是 RLS 靜默過濾的典型症狀：下拉不是空的、只是「少了幾支」，
--    看起來像「我們只有一支 bot」，不像權限問題。
--
-- ── 為什麼是新增 policy 而不是改既有的 ──────────────────────────
-- 既有三條都是 PERMISSIVE FOR ALL；多條 PERMISSIVE policy 是 OR 關係。
-- 所以另外加一條 **FOR SELECT** 的，效果是：
--   · 平台維運角色（含 assistant）→ 讀得到全部
--   · 寫入（INSERT/UPDATE/DELETE）→ 仍然只受原本那條管，assistant 改不了任何 bot
-- 直接放寬原本的 FOR ALL 會連寫入一起開，那不是這次要的。
--
-- ── 風險範圍 ────────────────────────────────────────────────
-- assistant 目前只有 notify-config:view / notify-config:manage 兩個權限，
-- 拿不到 line-bots:view，所以它讀得到這些列，也只能透過通知設定的端點看到
-- 「bot 名稱 / 租戶名稱 / 群組名稱」。channel_secret_enc 與 access_token_enc
-- 是加密欄位，解密只發生在 server 內部（發送與探測），從不回給前端。

BEGIN;

DROP POLICY IF EXISTS line_bot_platform_ops_read ON line_bot;
CREATE POLICY line_bot_platform_ops_read ON line_bot
  FOR SELECT USING (app_is_platform_ops());

DROP POLICY IF EXISTS line_group_platform_ops_read ON line_group;
CREATE POLICY line_group_platform_ops_read ON line_group
  FOR SELECT USING (app_is_platform_ops());

-- tenants 一起放行：不然 sendable-targets 的 LEFT JOIN 撈不到租戶名，
-- 下拉會變成「A機器人 / B機器人」這種分不出是哪一家的清單。
DROP POLICY IF EXISTS tenants_platform_ops_read ON tenants;
CREATE POLICY tenants_platform_ops_read ON tenants
  FOR SELECT USING (app_is_platform_ops());

COMMIT;
