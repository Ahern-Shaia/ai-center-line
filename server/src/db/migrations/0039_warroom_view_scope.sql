-- Migration 0039 · 修「看得到卻點不動」的總覽儀表（navigation-and-capability-gating M3）
--
-- 症狀：aiproot_admin 登入後預設就落在「總覽儀表」，畫面上是紅色的
--   [api] /warroom → 403 角色無權限
-- 因為側欄用 warroom-tasks:view 過濾（aiproot 有），端點卻寫死
--   @Roles("tenant_admin", "group_owner", "consultant")（aiproot 不在裡面）。
-- 這正是 M1 要消滅的那類分岔：**閘門在兩個地方，而且兩邊不一樣**。
--
-- 修法：戰情室三頁改成端點與側欄吃同一組權限碼
--   總覽儀表  warroom:view        （0019 就建好但從沒被引用的死碼，這次接上）
--   任務看板  warroom-tasks:view
--   對話紀錄  warroom-daily:view
--
-- ⚠️ warroom:view 目前也授權給 employee。接上線的那一刻，employee 就會
--    看到「總覽儀表」—— 今天他看不到。行為保持優先，先收回；
--    要開放請用權限管理頁按客戶開。
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.role_id AND r.is_system = true
  AND r.role_key = 'employee' AND rp.permission_id = 'warroom:view';

-- Cache 提示 · 需 /roles/invalidate 或等 5 min TTL
