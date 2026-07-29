-- Migration 0037 · 導覽權限碼補完（navigation-and-capability-gating M1）
--
-- 目的：讓「誰看得到哪一頁」變成**權限管理裡可調的資料**，而不是要改程式碼重新部署。
--
-- ⚠️ 盤點後的意外發現：15 項裡有 12 項**權限碼早就存在**（0019 建的），
--    只是從來沒有任何程式碼引用 —— `grep` 全庫 0 次命中。
--    也就是說 aiproot 在權限管理頁上勾了 `convo:view`，什麼也不會發生。
--    比「沒有權限碼」更糟：它看起來有效。
--    本 migration 只補真正缺的 7 個，其餘靠 controller / 側欄接線（同一批 commit）。
--
-- ⚠️ 本 migration **刻意不改變任何人現在看得到什麼**。
--    死碼一旦接上，0019 當初依「理想矩陣」寫的授權就會立刻生效 ——
--    那等於在沒人裁定的情況下把三個頁面開放給客戶。所以下面第 3 段把
--    那幾筆「寫了但從未生效」的授權收回，讓接線是純粹的行為保持。
--    要開放是之後用權限管理頁按客戶逐一開，那才是本案的目的。

-- ============================================================
-- 1. 真正缺的權限碼
-- ============================================================
INSERT INTO permissions (permission_id, resource, action, description, scope) VALUES
  -- 我的行程 · 個人頁，跟「我的日報」同級（personal-report:mine 已存在）
  ('trips:mine', 'trips', 'mine', '檢視自己的外勤行程', 'tenant'),

  -- 平台健康度三頁（M4 會併成「系統健康」的三個 tab，權限刻意分開 · OQ-NAV-6）
  ('extraction-health:view', 'extraction-health', 'view', '檢視抽取健康度', 'platform'),
  ('completion-tracking:view', 'completion-tracking', 'view', '檢視任務完成追蹤', 'platform'),

  -- 地圖里程設定（既有的 map:view 是「客戶地圖」那頁，不是這個 · 名字很像但無關）
  ('map-config:view', 'map-config', 'view', '檢視地圖里程設定', 'platform'),
  ('map-config:manage', 'map-config', 'manage', '改地圖里程設定 / 圖磚金鑰', 'platform'),

  -- LINE 綁定稽核 · 跨租戶版。與租戶自己的「員工 LINE 綁定」(binding:view) 分開，
  -- 否則同一個碼要同時代表「看自家」與「看全平台」，那是兩件事
  ('binding:aiproot-view', 'binding', 'aiproot-view', '跨租戶檢視 LINE 綁定稽核', 'platform'),

  -- 租戶管理（含重設密碼）· tenants:view 是唯讀清單（租戶切換器要用，顧問也需要），
  -- 管理頁要另一個碼，否則顧問會看到自己點不動的東西
  ('tenants:manage', 'tenants', 'manage', '管理租戶（含重設密碼 / 解鎖）', 'platform')
ON CONFLICT (permission_id) DO NOTHING;

-- ============================================================
-- 2. Role → Permission · 對齊「今天實際看得到什麼」
-- ============================================================
-- aiproot_admin：全拿
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'aiproot_admin' AND r.is_system = true
  AND p.permission_id IN (
    'trips:mine', 'extraction-health:view', 'completion-tracking:view',
    'map-config:view', 'map-config:manage', 'binding:aiproot-view', 'tenants:manage')
ON CONFLICT DO NOTHING;

-- consultant：唯讀那幾項（不含 manage · 顧問不改設定、不重設密碼）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'consultant' AND r.is_system = true
  AND p.permission_id IN (
    'trips:mine', 'extraction-health:view', 'completion-tracking:view',
    'map-config:view', 'binding:aiproot-view')
ON CONFLICT DO NOTHING;

-- 客戶方三個角色：只有「我的行程」（個人頁，人人有）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key IN ('tenant_admin', 'group_owner', 'employee') AND r.is_system = true
  AND p.permission_id = 'trips:mine'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. ⚠️ 收回「寫了但從未生效」的授權
-- ============================================================
-- 這三筆是 0019 依理想矩陣先寫下的，但因為沒有任何程式碼引用那些碼，
-- 從來沒有生效過。接線的同一刻它們會突然生效 = 在沒人裁定的情況下
-- 把頁面開放給客戶。先收回，之後要開放請用權限管理頁按客戶開。
--
--   categories:view / tenant_admin  → 分類管理今天是 aiproot 頁（M4 併入「任務設定」時再開放）
--   binding:view    / aiproot,consultant → 這個碼代表「看自家綁定」，平台側用 binding:aiproot-view
--   media:view      / employee      → 素材看板今天員工看不到（側欄分組已排除）
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.role_id AND r.is_system = true
  AND (
    (r.role_key = 'tenant_admin' AND rp.permission_id = 'categories:view')
    OR (r.role_key IN ('aiproot_admin', 'consultant') AND rp.permission_id = 'binding:view')
    OR (r.role_key = 'employee' AND rp.permission_id = 'media:view')
  );

-- Cache 提示 · 需 /roles/invalidate 或等 5 min TTL
