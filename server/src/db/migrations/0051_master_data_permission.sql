-- Migration 0051 · 「資料來源」改用權限碼把關（原本是 @Roles 角色白名單）
--
-- ── 症狀 ──────────────────────────────────────────────────────
-- 助理登入後側邊欄看得到「資料來源」，點進去畫面正常渲染出
-- 「0 筆客戶 / 尚未連線 Ragic」，角落閃一個「角色無權限」的 toast 就沒了。
-- 那兩個數字都是假的 —— 我們不是查到 0，是被拒絕，根本不知道有幾筆。
--
-- ── 根因：三套閘門互相不知道對方存在 ──────────────────────────
--   側邊欄  Shell.tsx     perm: "notify-config:view"           → 助理有 → 顯示
--   後端    controller    @Roles('aiproot_admin','consultant') → 助理不在 → 403
--   畫面    MasterData    catch 只跳 toast、state 留初始值      → 渲染成空狀態
--
-- 而且 `notify-config:view` 根本是**別頁的**權限碼，被借來當側邊欄的閘門 ——
-- 「看得到通知設定」跟「能設定客戶名冊來源」是兩件事，綁在一起遲早會錯開。
--
-- ⚠️ 本 migration **不改變任何人的實際權限**：
--    新權限碼只給 aiproot_admin 與 consultant，正是 @Roles 原本放行的那兩個。
--    改的是「用哪一套機制表達」，不是「誰能做」。
--
-- 這是 permission-engine 那 16 個還在用 @Roles 的端點之一（其餘 102 個已用權限碼）。
--
-- ⚠️ 不用 ON CONFLICT (resource, action) —— `permissions` 上**沒有**那組唯一約束
--    （只有 permission_id 主鍵）。寫了會直接報
--    「there is no unique or exclusion constraint matching the ON CONFLICT specification」。
--    用 NOT EXISTS 表達冪等，不依賴約束。

-- ⚠️ `permissions.permission_id` **沒有 DEFAULT**（查過 information_schema），
--    所以要自己給 gen_random_uuid()。少了它會炸
--    「null value in column "permission_id" violates not-null constraint」。
--    這是本機套用時抓到的 —— 直接上 prod 就是一個失敗的 migration。
INSERT INTO permissions (permission_id, resource, action, scope, description)
SELECT gen_random_uuid(), 'master-data', 'manage', 'platform', '設定客戶名冊來源（Ragic 表單）與手動同步'
 WHERE NOT EXISTS (
   SELECT 1 FROM permissions WHERE resource = 'master-data' AND action = 'manage'
 );

-- role_permissions 的主鍵是 (role_id, permission_id)，這裡的 ON CONFLICT 有對應約束
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM roles r
  CROSS JOIN permissions p
 WHERE r.role_key IN ('aiproot_admin', 'consultant')
   AND r.is_system
   AND p.resource = 'master-data' AND p.action = 'manage'
ON CONFLICT DO NOTHING;
