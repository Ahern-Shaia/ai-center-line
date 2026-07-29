-- Migration 0049 · 「助理」升格為第 6 個內建角色
-- docs/modules/custom-roles.md §5.2
--
-- 背景：客戶在「角色權限管理」建了一個自訂角色 assistant（助理），給了兩個權限碼
-- （notify-config.view / notify-config.manage）。但系統四層都寫死內建角色，
-- 所以那個角色**0 個帳號在用，而且不可能有人用**——UI 讓他完成了一個到不了任何地方的動作。
--
-- 完整的自訂角色功能已凍結（判準見 doc §4.2：一線產品多半 8～10 年後才做，
-- 我們 1 家客戶 19 個帳號、四條動手判準命中 0 條）。
-- 客戶要的是**一個助理角色**，不是**一個角色工廠** —— 所以就地升格。
-- 這也是 Linear／Figma 的做法：固定角色 + 需要時加一個。
--
-- ⚠️ 用 UPDATE 就地升格，**不新建一列**。新建的話下拉會出現兩個「助理」，
--    而且客戶原本設的那兩個權限碼會留在孤兒列上。

-- ① 建立或升格。
--
-- ⚠️ **必須是 upsert，不能只有 UPDATE。**
--    第一版只寫了 UPDATE，因為 prod 上那一列已經存在（客戶建的）。
--    但在**任何全新的資料庫**（本機 dev、未來的新環境、災後重建）那一列根本不存在，
--    於是會變成：`users_role_check` 放行「助理」、下拉也列出「助理」，
--    但 `roles` 沒有對應列 → 權限查不到 → **被指派的人登入後畫面全空、而且不報錯**。
--    （＝ doc FMEA R-2 那個失效模式，靠本機套用時發現 UPDATE 回 0 列才抓到。）
--
--    `tenant_id` 維持 NULL 是正確的：內建角色本來就是全域的（其餘 5 個也都是 NULL）。
--    升成 is_system = true 之後，permission.service.ts 那句 `AND r.is_system = true`
--    自然就查得到它，權限解析端**一行都不用改**。
INSERT INTO roles (role_key, role_name, is_system, tenant_id)
VALUES ('assistant', '助理', true, NULL)
ON CONFLICT (role_key, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid))
DO UPDATE SET is_system = true, updated_at = now();

-- ② 權限碼：沿用客戶當初自己勾的那兩項（通知設定的檢視與管理）。
--    ON CONFLICT DO NOTHING —— prod 上已經有這兩列，這裡只補全新環境。
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM roles r
  CROSS JOIN permissions p
 WHERE r.role_key = 'assistant'
   AND r.tenant_id IS NULL
   AND p.resource = 'notify-config'
   AND p.action IN ('view', 'manage')
ON CONFLICT DO NOTHING;

-- ② users.role 的 CHECK 要放行，否則指派時 INSERT 會被擋
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('aiproot_admin', 'consultant', 'tenant_admin', 'group_owner', 'employee', 'assistant')
);

COMMENT ON COLUMN users.role IS
  '內建角色 role_key · 與 roles.role_key 對應 · 自訂角色功能已凍結（docs/modules/custom-roles.md §4）';
