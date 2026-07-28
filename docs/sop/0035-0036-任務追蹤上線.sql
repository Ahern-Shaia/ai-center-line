-- 任務追蹤到結束 · prod migration（0035 ＋ 0036）
-- 依 docs/modules/task-completion-tracking.md
--
-- ⚠️⚠️ **執行順序不可顛倒：先跑這個 SQL，再 push 程式碼。**
--
-- 為什麼：新程式碼會讀寫 work_status / pending_completion_signal /
-- analysis_upload.source_message_ids。這些東西 prod 現在還沒有 ——
-- 先 push 的話，Render 自動部署完成的那一刻起：
--   · 任務看板會 500（SELECT 不存在的欄位）
--   · webhook 收到引用回覆會噴錯（INSERT 不存在的表）
--   · 分析批次的材料化會失敗
--
-- 反過來先跑 SQL 是**安全的**：兩個 migration 都是純新增
-- （ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS），
-- 舊程式碼看不到新欄位，照常運作。所以「先 SQL、後 push」中間
-- 這段空窗期不會有任何異常。
--
-- 依 R10：本檔只產生指令，由人手動在 prod 執行。

-- ============================================================
-- STEP 0 · 先確認要動的東西的現況（不改任何資料）
-- ============================================================
SET app.actor_role = 'aiproot_admin';

-- 0035 有一道保護：tickets.source_message_ids 若已有資料就會 RAISE EXCEPTION。
-- 先自己看一眼，預期是 0。
SELECT count(*) AS 已有溯源資料的任務數
  FROM tickets
 WHERE source_message_ids IS NOT NULL AND array_length(source_message_ids, 1) > 0;

-- 預期 0 row（這兩個都還不存在）
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'tickets' AND column_name LIKE 'work\_%';
SELECT to_regclass('public.pending_completion_signal') AS 完成訊號表;

-- ============================================================
-- STEP 1 · 執行 migration
--
-- 貼上 server/src/db/migrations/0035_source_message_ids.sql 全文
-- 再貼上 server/src/db/migrations/0036_work_status.sql 全文
--
-- ⚠️ 兩個檔案都要用「migration 連線」（owner 權限）跑，不是 app_rw ——
--    要建表、加約束、改 RLS policy。
-- ============================================================

-- ============================================================
-- STEP 2 · 驗證（跑完 STEP 1 之後）
-- ============================================================
SET app.actor_role = 'aiproot_admin';

-- 預期 13 個 work_* 欄位
SELECT count(*) AS work欄位數 FROM information_schema.columns
 WHERE table_name = 'tickets' AND column_name LIKE 'work\_%';

-- 預期 4 條約束（status / outcome / via / 跨軸）
SELECT conname FROM pg_constraint
 WHERE conrelid = 'tickets'::regclass AND conname LIKE '%work%'
 ORDER BY conname;

-- 預期表存在、RLS 開著
SELECT relname, relrowsecurity AS rls開, relforcerowsecurity AS force開
  FROM pg_class WHERE relname = 'pending_completion_signal';

-- 既有任務應該全部落在 work_status='open'（DEFAULT），且沒有半套的結束欄位
SELECT work_status, count(*) FROM tickets GROUP BY 1;
SELECT count(*) AS 半套結束的票 FROM tickets
 WHERE (work_status = 'closed') <> (work_outcome IS NOT NULL);   -- 預期 0

-- ============================================================
-- STEP 3 · 這時候才 push 程式碼
-- ============================================================
-- git push origin main
--
-- Render 會自動部署。部署完成後跑 STEP 4 的 smoke。

-- ============================================================
-- STEP 4 · 部署後 smoke（人工，約 2 分鐘）
-- ============================================================
-- ① /health 帶 cache-buster 確認新版上了（rolling deploy 要多打幾次）
--    curl "https://<backend>.onrender.com/health?t=$(date +%s)"
--    → commit SHA 應該是這次 push 的
--
-- ② 開任務看板 → 三欄要正常載入（這頁現在會 SELECT work_* 欄位）
--
-- ③ 開 AIPROOT 管理 → 任務完成追蹤 → 三個區塊要出得來（數字全 0 是正常的）
--
-- ④ 在測試群裡引用一則訊息回「已完成」，然後查：
SELECT intent, resolution, note, received_at
  FROM pending_completion_signal ORDER BY received_at DESC LIMIT 5;
--    → 應該要有一筆 intent='completion' · resolution 為 null（等當晚批次對應）
--    → LINE 群裡應該收到「✓ 已收到完成回報」
--
-- ⑤ 隔天 18:00 批次跑完後再查一次，resolution 應該變成
--    closed_ticket 或 created_ticket（對不上任務時會回頭補建）

-- ============================================================
-- 回滾
-- ============================================================
-- 程式碼：Render 後台 rollback 到前一個 deploy。
-- 資料庫：**不需要回滾** —— 兩個 migration 都是純新增，
--         舊程式碼不會碰到那些欄位。留著即可，下次部署還會用到。
