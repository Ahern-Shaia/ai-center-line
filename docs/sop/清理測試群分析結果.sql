-- 清理某個 LINE 群的分析結果（例：測試群被誤按「立即分析」而出現在前端）
--
-- ⚠️ 依 CLAUDE.md R10：本檔只產生指令，**由人手動在 prod 執行**。
-- ⚠️ 一定要先跑 STEP 1 看清楚會刪掉什麼，確認無誤再跑 STEP 3。
--
-- 刪除順序不能反：tickets 與 analysis_batch 對 analysis_upload 是 ON DELETE SET NULL，
-- 先刪 upload 的話，那兩張表會留下「來源是 null」的孤兒列，
-- 任務看板與對話分析歷程照樣看得到 —— 看起來像沒刪乾淨。
--
-- 不刪 line_message（LINE 收到的原始訊息 = 事實來源，R11 原始不可變）。
-- 只要把該群的 analyze_enabled 關掉，之後就不會再被分析（見 STEP 4）。

-- ============================================================
-- STEP 0 · ⚠️ 先開 RLS 上下文，否則所有查詢都回 0 rows（不是沒資料，是被擋）
-- ============================================================
-- 這幾張表都是 FORCE ROW LEVEL SECURITY —— 連 table owner 都受政策約束
-- （只有 superuser 會整個 bypass，Render 的 managed PG 一般不是 superuser）。
-- psql 直連沒有應用層的 SET，policy 讀到的 current_setting 全是 NULL → 一律不通過。
--
-- 各表要求不同，**兩個都要設**：
--   line_group      actor_role ∈ (aiproot_admin/consultant/system)  或 bot 的 tenant 相符
--   analysis_batch  tenant 相符 或 actor_role ∈ (...)
--   tickets         ⚠️ **一定要 tenant 相符**（AND 條件，沒有 actor_role 逃生門）
--   analysis_upload / analysis_result  無 RLS
--
-- 只設 actor_role 的話，前面查得到、但 STEP 3a 刪 tickets 會「成功刪掉 0 筆」，
-- 任務看板上的卡片還在 —— 又是一次無聲失敗。
SET app.actor_role = 'system';
SET app.current_tenant = '4d97eced-64c5-4a38-952b-dfce9588ab7c';   -- ← 台灣福祉；換租戶要改

-- 確認有生效（兩個都要有值）
SELECT current_setting('app.actor_role', true) AS actor_role,
       current_setting('app.current_tenant', true) AS tenant;

\set group_name '台灣福祉機器人測試群'

-- ============================================================
-- STEP 1 · 先看：這個群是誰、會影響哪些資料（不刪任何東西）
-- ============================================================
-- 查不到的話先確認：① STEP 0 有跑嗎 ② display_name 可能是 NULL
--（bot 沒抓到群名時就會是 NULL）→ 改用下面這句列出全部群再挑：
--   SELECT group_registry_id, group_id, display_name, analyze_enabled FROM line_group ORDER BY first_seen_at DESC;
SELECT group_registry_id, group_id, display_name, analyze_enabled, status
FROM line_group
WHERE display_name = :'group_name';

-- 把上面查到的 group_id（Cxxxx…）填進來，其餘 STEP 都用它
\set gid 'C請填入上面查到的_group_id'

SELECT 'upload' AS kind, count(*) FROM analysis_upload WHERE group_id = :'gid'
UNION ALL SELECT 'batch', count(*) FROM analysis_batch WHERE group_id = :'gid'
UNION ALL SELECT 'ticket', count(*) FROM tickets
  WHERE source_upload_id IN (SELECT id FROM analysis_upload WHERE group_id = :'gid');

-- 逐筆看 ticket 內容（確認沒有誤刪真實任務）
SELECT t.ticket_id, t.summary, t.confirm_status, t.source_upload_id
FROM tickets t
WHERE t.source_upload_id IN (SELECT id FROM analysis_upload WHERE group_id = :'gid');

-- ============================================================
-- STEP 2 · 保險：先備份要刪的 upload id（萬一要復原可對照）
-- ============================================================
SELECT id, filename, batch_date, status, created_at
FROM analysis_upload WHERE group_id = :'gid' ORDER BY id;

-- ============================================================
-- STEP 3 · 刪除（順序固定 · 一個 transaction）
-- ============================================================
BEGIN;

-- 3a. 先刪 ticket（FK 是 SET NULL，不會自己跟著走）
--     ⚠️ 若這句回 DELETE 0 但 STEP 1 明明有查到 ticket → app.current_tenant 沒設對
DELETE FROM tickets
WHERE source_upload_id IN (SELECT id FROM analysis_upload WHERE group_id = :'gid');

-- 3b. 刪 batch 紀錄（對話分析歷程頁的來源）
DELETE FROM analysis_batch WHERE group_id = :'gid';

-- 3c. 刪 upload → analysis_result / analysis_label 會 CASCADE 一起走
DELETE FROM analysis_upload WHERE group_id = :'gid';

-- 確認數字合理再 COMMIT；不對就 ROLLBACK;
COMMIT;

-- ============================================================
-- STEP 4 · 關掉這個群的 AI 分析，避免下次又被分析進來
--          （也可以直接在前端「設定 → LINE 群組」把 AI 分析關掉，不必跑 SQL）
-- ============================================================
UPDATE line_group SET analyze_enabled = false WHERE group_id = :'gid';

-- ============================================================
-- STEP 5 · 驗證：三個數字都要是 0
-- ============================================================
SELECT 'upload' AS kind, count(*) FROM analysis_upload WHERE group_id = :'gid'
UNION ALL SELECT 'batch', count(*) FROM analysis_batch WHERE group_id = :'gid'
UNION ALL SELECT 'ticket', count(*) FROM tickets
  WHERE source_upload_id IN (SELECT id FROM analysis_upload WHERE group_id = :'gid');
