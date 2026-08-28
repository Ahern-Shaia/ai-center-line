-- 0072 · 示範資料頁的三個權限碼改為 platform scope · 租戶不可自行勾選
--
-- 2026-08-29 用戶裁定：知識庫收回，只留平台端。
--
-- ══ 為什麼不是「再 DELETE 一次」 ═══════════════════════════════
--
-- 0043（2026-07-27）已經做過一模一樣的 DELETE，把 rag:view / km:view /
-- map:view 從 tenant_admin / group_owner / employee 收回。
-- 但今天 i18n 渲染掃描用 gm@taiwanhomecare 登入，知識庫**照樣畫得出來** ——
-- tenant_admin 又有 km:view 了。
--
-- 追下去：0044～0071 沒有任何一支重新授予。是**從 UI 勾回來的** ——
-- 這三個權限的 `scope` 是 `'tenant'`，而 0067 的租戶權限管理頁
-- （tenant-roles.service.ts 的 TENANT_VISIBLE_SCOPES = tenant + department）
-- 就是照 scope 決定「租戶自己能不能勾」。
--
-- ⭐ 所以 0043 收的是**結果**，沒收**能力**。同一件事再 DELETE 一次，
--    下次有人在權限頁點一下又回來了。
--
-- ⚠️ 我原本只想 DELETE km:view —— 那是照著我本機資料庫量出來的結論，
--    而本機正是被我自己勾髒的。停下來追「誰把它加回去的」才看到真正的洞。
--    （memory: rule_verify_premise_with_prod_data）
--
-- ══ 這三頁現在是什麼 ═════════════════════════════════════════
--   智慧檢索 web/src/kb/Rag.tsx           → mockdata/ragQA.ts（預錄問答對）
--   知識庫   web/src/kb/KnowledgeBase.tsx → mockdata/knowledgeCards.ts（12 張手寫卡）
--   客戶地圖 web/src/kb/CustomerMap.tsx   → mockdata/customers.ts
-- 三頁都掛著 DemoDataBanner。沒有一筆是真的。
--
-- ⚠️ scope 改成 'platform' 的語意：**誰可以授予它**，不是「它屬於誰」。
--    這三個功能將來做出來了，要改回 'tenant' 才會重新出現在租戶權限頁。
--    做 rag-conversations M1 的人請回來改這裡。

BEGIN;

-- ① 能力：租戶權限頁不再列出這三項（看不到就勾不了 —— 同 0067 P0-B 的理由，
--    靠前端隱藏擋不住會改請求的人）
UPDATE permissions
   SET scope = 'platform'
 WHERE permission_id IN ('rag:view', 'km:view', 'map:view');

-- ② 結果：收回現有的授予。
--    ⚠️ 條件要**明確列出要收的對象**，不可以寫 `role_key NOT IN (…)` ——
--    `npm run migrate` 沒有套用紀錄、每次從 0001 重跑
--    （memory: migrate-runner-reverts-policies），那種寫法會在日後新增
--    任何平台角色時把它的權限靜默剝掉。
DELETE FROM role_permissions rp
USING roles r
WHERE r.role_id = rp.role_id
  AND rp.permission_id IN ('rag:view', 'km:view', 'map:view')
  AND r.is_system = true
  AND r.role_key IN ('tenant_admin', 'group_owner', 'employee');

-- ③ 租戶自建角色 —— 它們從基準角色複製權限，可能帶著這幾項。
--    判準是 is_system = false **且** 掛在某個租戶底下；
--    平台角色（aiproot_admin / consultant / assistant）全是
--    is_system = true + tenant_id IS NULL，不會被這段掃到。
DELETE FROM role_permissions rp
USING roles r
WHERE r.role_id = rp.role_id
  AND rp.permission_id IN ('rag:view', 'km:view', 'map:view')
  AND r.is_system = false
  AND r.tenant_id IS NOT NULL;

COMMENT ON TABLE role_permissions IS
  '角色→權限對應 · ⚠️ rag:view / km:view / map:view 對應的頁面仍是示範資料，'
  '刻意只留給 aiproot_admin / consultant，且 scope=platform 讓租戶勾不到（0043 → 0072）';

COMMIT;

-- ── 套用後檢查（貼進 psql 跑）──
--
-- 應該只剩 aiproot_admin / consultant：
--   SELECT r.role_key, rp.permission_id
--     FROM role_permissions rp JOIN roles r ON r.role_id = rp.role_id
--    WHERE rp.permission_id IN ('rag:view','km:view','map:view')
--    ORDER BY 1, 2;
--
-- 三項都要是 platform：
--   SELECT permission_id, scope FROM permissions
--    WHERE permission_id IN ('rag:view','km:view','map:view');
--
-- ⚠️ 套完要讓權限快取失效（/roles/invalidate 或等 5 min TTL），
--    已登入的 tenant_admin 側欄才會少掉那幾項。
