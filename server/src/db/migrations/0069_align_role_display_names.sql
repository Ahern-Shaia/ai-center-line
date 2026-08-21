-- 0069 · 角色顯示名對齊「部門主管 / 員工」
--
-- 病灶：`d06ea9a`（2026-07-30）把使用者看到的「群組負責人」改成「部門主管」，
-- commit message 明寫「label only · role key / DB / DTO 都不動」—— 在當時是對的，
-- 因為那時**沒有任何畫面在讀 `roles.role_name`**。
--
-- 2026-08-21 的權限管理頁（0067）開始讀它，前提就破了：
--   權限管理 → 「群組負責人」「一般員工」（DB）
--   部門/成員 → 「部門主管」「員工」（前端硬編）
-- 客戶在權限管理設定完，回成員頁找不到同名角色，合理地以為權限沒生效。
--
-- ⚠️ 只改顯示名。`role_key`（group_owner / employee）一個字都不動 ——
--    JWT、`users_role_check`、DTO RoleEnum、權限比對全部吃 role_key。
--
-- 判準（值得記著）：改顯示名時要問的不是「現在誰在讀」，
-- 而是「這個值會不會變成 user-visible」。role_name 就是那種遲早會被讀的欄位。

UPDATE roles SET role_name = '部門主管', updated_at = now()
WHERE role_key = 'group_owner' AND role_name = '群組負責人';

UPDATE roles SET role_name = '員工', updated_at = now()
WHERE role_key = 'employee' AND role_name = '一般員工';

-- 租戶自訂角色（fork）在建立當下複製了系統角色的 role_name，
-- 所以舊名可能已經被複製出去。條件同上：只改還是舊名的，
-- 租戶自己改過名字的不動（那是他們的設定，不是我們的漏改）。
-- 套用時若這兩句 UPDATE 0 —— 表示還沒有人 fork 過，正常。

-- 驗證（套完自己看一眼，別假設）：
--   SELECT role_key, role_name, tenant_id FROM roles ORDER BY role_key;
--   期望 group_owner→部門主管、employee→員工，其餘不變。
