-- 0067_tenant_role_permissions.sql — 權限管理開放給租戶自己調
-- 冪等：可重跑
--
-- 對應 docs/modules/tenant-role-permissions.md v0.2（OQ-TRP-1..10 全採建議）
--
-- 做兩件事：
--   ① 加 roles:manage-tenant 權限碼，給 tenant_admin
--   ② 把租戶看得到的那 26 項權限說明，從「開發者版」改寫成「使用者版」
--
-- ⚠️ roles / role_permissions 的**結構完全不用改** —— 0010 當初就留好了
--    （roles.tenant_id 註解直接寫「NULL = built-in」，users.role_id 也在）。
--    分岔（fork on edit）純粹是應用層行為，不需要新欄位。

BEGIN;

-- ============================================================
-- ① 新權限碼
-- ============================================================
-- ⚠️ permission_id 必須是 'resource:action' 字串，**不可以用 gen_random_uuid()**。
--    0051 / 0052 / 0055 都踩過：guard 與前端都是拿 'resource:action' 比對，
--    用 uuid 會變成「勾了卻不生效」而且查不出原因（修法見 0056）。
INSERT INTO permissions (permission_id, resource, action, description, scope) VALUES
  ('roles:manage-tenant', 'roles', 'manage-tenant', '調整本公司角色的權限', 'tenant')
ON CONFLICT (permission_id) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, 'roles:manage-tenant'
FROM roles r
WHERE r.role_key = 'tenant_admin' AND r.is_system = true
ON CONFLICT DO NOTHING;

-- ============================================================
-- ② 權限說明改寫成使用者版
-- ============================================================
-- 為什麼要改：這些字原本是寫給開發者看的（「管理自 tenant 部門 CRUD」
-- 「檢視任務看板 Kanban」「簽核 tickets」），而 0067 之後它們會直接出現在
-- 總經理的畫面上。技術精確度沒有損失 —— permission_id 本身仍帶著它
-- （departments:manage-tenant），而 aiproot 端看得到代號。
--
-- 只改 scope IN ('tenant','department') 這 26 項（＝租戶看得到的）。
-- platform 那 34 項維持原文，那是我們自己在看的。

UPDATE permissions SET description = v.d FROM (VALUES
  ('warroom:view',                   '查看總覽儀表'),
  ('warroom-tasks:view',             '查看任務看板'),
  ('warroom-daily:view',             '查看群組日誌'),
  ('signoff:view',                   '查看待簽核項目'),
  ('signoff:action',                 '簽核項目'),
  ('personal-report:team',           '查看部門同仁的日報'),
  ('personal-report:mine',           '填寫與查看自己的日報'),
  ('trips:mine',                     '查看自己的外勤行程'),
  ('rag:view',                       '使用智慧檢索'),
  ('media:view',                     '查看素材'),
  ('km:view',                        '查看知識庫'),
  ('map:view',                       '查看客戶地圖'),
  ('departments:view',               '查看部門'),
  ('departments:manage-tenant',      '新增、修改、刪除部門'),
  ('users:view',                     '查看成員名單'),
  ('users:create-group-owner',       '建立部門主管帳號'),
  ('line-groups:view',               '查看公司的 LINE 群組'),
  ('binding:view',                   '查看誰綁定了 LINE 帳號'),
  ('categories:view',                '查看分類設定'),
  ('task-config:view',               '查看任務設定'),
  ('task-config:timing',             '調整任務的時間規則'),
  ('scheduler-config:view',          '查看自動分析的排程'),
  ('scheduler-config:manage-tenant', '調整自動分析的時間'),
  ('tenant-config:view',             '查看公司設定'),
  ('tenant-config:manage',           '修改公司設定'),
  ('audit:view',                     '查看操作紀錄')
) AS v(id, d)
WHERE permissions.permission_id = v.id;

COMMIT;

-- ── 套用後檢查（貼進 psql 跑）──
--
--   SET app.actor_role = 'aiproot_admin';
--   -- 應為 27（26 項改寫 + roles:manage-tenant）
--   SELECT count(*) FROM permissions WHERE scope IN ('tenant','department');
--   -- 應該一列都沒有（沒有殘留的開發者用語）
--   SELECT permission_id, description FROM permissions
--    WHERE scope IN ('tenant','department')
--      AND (description LIKE '%tenant%' OR description LIKE '%CRUD%'
--        OR description LIKE '%Kanban%' OR description LIKE '%ticket%');
