-- Migration 0044 · aiproot 做「設定」不做「營運」
--
-- 用戶裁定（2026-07-29）：「登入時就按權限分流，符合系統管理權限的到 admin 頁面」。
--
-- 這個分野其實**早就存在**，只是沒有貫徹到導覽：
--   Shell.tsx 的 brandFor() 已經把 aiproot 顯示成「AIPROOT 平台後台」、
--   客戶顯示成「戰情室」—— 品牌層是兩個產品，導覽卻是同一棵樹。
--
-- 結果就是 aiproot 側欄有 6 個項目點進去必然是空的：
--   tickets / daily_reports 的 RLS 是 AND-only（tenant_id = current_tenant AND ...），
--   而 aiproot 沒有租戶 → 永遠 0 筆。而「我的日報／我的行程」對他更沒有意義，
--   他不是任何一家公司的員工。
--
-- ⚠️ 先前 doc §3.3 寫的是「租戶那 10 項照舊（看的是選定的租戶）」，
--    那需要一個全域租戶切換器（沒做，也不打算做）。本 migration 改採
--    「兩個產品」的方向 —— doc 已同步更正。
--
-- ⭐ 這支不需要任何程式碼改動：M1 已經把側欄改成 100% 由權限碼驅動，
--    收回碼 → 項目消失 → 「我的」「營運」兩組空了會自動整組隱藏。
--
-- 代價（明確記下來）：客戶回報「這張任務怎麼沒被歸屬」時我們看不到那張卡。
-- 要解是之後在「租戶管理」加「以該租戶身分檢視」的入口，不是現在。
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.role_id
  AND r.is_system = true
  AND r.role_key IN ('aiproot_admin', 'consultant')
  AND rp.permission_id IN (
    'personal-report:mine',   -- 我的日報 · aiproot 不是員工
    'trips:mine',             -- 我的行程 · 同上
    'warroom:view',           -- 總覽儀表 ┐
    'warroom-tasks:view',     -- 任務看板 ├ 客戶每天在用的營運頁
    'warroom-daily:view',     -- 群組日誌 │
    'media:view'              -- 素材     ┘
  );

-- Cache 提示 · 需 /roles/invalidate 或等 5 min TTL
