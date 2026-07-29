-- Migration 0043 · 把三個「還在吃假資料」的頁面鎖回平台側
--
-- 智慧檢索（rag）／知識庫（km）／客戶地圖（map）目前跑的是寫死的示範資料：
--   web/src/mockdata/ragQA.ts 是 177 行預錄問答對，使用者打的問題去比對那份
--   清單、命中就播放答案 —— 那是腳本不是檢索。
--
-- 2026-07-27 把它們從側欄拿掉，理由是「寧可沒有這頁，也不可在客戶畫面上
-- 放做不到的東西」（同一天下架的還有整頁 24 項全假的「公司設定」）。
--
-- 2026-07-29 用戶要把智慧檢索與知識庫掛回來，**但只給我司看** ——
-- 對內討論規格、對客戶簡報方向都需要它，而客戶端不該看到。
--
-- 問題是這三個權限碼目前**授權給所有角色**（0010 建的時候是照理想矩陣寫的）。
-- 直接掛回側欄的話，台灣福祉每個人都會看到假的 AI。先收回。
--
-- ⚠️ 本表是 FORCE RLS 嗎：role_permissions 沒有 RLS（已查），所以不需要
--    SET LOCAL actor_role。但這件事每次都要查，不可以憑印象（0041 的教訓）。
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.role_id
  AND r.is_system = true
  AND r.role_key IN ('tenant_admin', 'group_owner', 'employee')
  AND rp.permission_id IN ('rag:view', 'km:view', 'map:view');

COMMENT ON TABLE role_permissions IS
  '角色→權限對應 · ⚠️ rag:view / km:view / map:view 對應的頁面仍是示範資料，'
  '刻意只留給 aiproot_admin / consultant（migration 0043）';

-- Cache 提示 · 需 /roles/invalidate 或等 5 min TTL
