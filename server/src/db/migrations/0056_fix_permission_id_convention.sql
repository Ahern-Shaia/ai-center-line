-- Migration 0056 · 修正 permission_id 慣例（P0：多個 tenant_admin 權限完全失效）
--
-- ── 根因 ────────────────────────────────────────────────────
-- permissions.permission_id 是 text PK，內建權限用 'resource:action'（如 'users:manage'）。
-- 但 permission.guard.ts 與前端 perms.has() 都是拿 @RequirePermission 的 'resource:action'
-- 字串去比對 permission_id。0051/0052/0055 卻誤用 gen_random_uuid() 當 id →
-- 這些權限的 guard **永遠 deny**、前端 perms.has() **永遠 false**：
--   master-data:manage / users:assign-department（MDA）/ users:assign-role / users:delete-member
-- 表面「有勾權限」但完全不生效（guard 用 UUID 比字串，對不上）。
--
-- ── 修法 ────────────────────────────────────────────────────
-- 對每個「permission_id ≠ resource:action」的權限：建正確 id 的同義權限 → 轉移 role_permissions
-- → 刪舊 UUID 權限。冪等（只動不合慣例的列），dev/prod 皆可安全套、可重跑。

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT permission_id AS old_id, resource || ':' || action AS new_id,
           resource, action, scope, description
    FROM permissions
    WHERE permission_id <> resource || ':' || action
  LOOP
    -- 1) 建正確 id 的權限（新 id 此前不存在 → 之後轉移的 FK 有對象）
    INSERT INTO permissions (permission_id, resource, action, scope, description)
    VALUES (r.new_id, r.resource, r.action, r.scope, r.description)
    ON CONFLICT (permission_id) DO NOTHING;

    -- 2) 轉移授權（new_id 此前無任何 grant → 不會撞 role_permissions PK）
    UPDATE role_permissions SET permission_id = r.new_id WHERE permission_id = r.old_id;

    -- 3) 刪舊 UUID 權限（已無 role_permissions 指向它）
    DELETE FROM permissions WHERE permission_id = r.old_id;
  END LOOP;
END $$;
