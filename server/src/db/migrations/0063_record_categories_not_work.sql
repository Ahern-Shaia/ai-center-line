-- 0063_record_categories_not_work.sql — 紀錄類分類不進工作生命週期
-- 冪等：可重跑
--
-- 背景（2026-08-12）：
-- 台灣福祉的群組裡，機器人對「大文 8/10 工作日報」回了一句
-- 「尚未確認完成 · 做完了就引用那則訊息回一句就好」。
-- 日報是**已經做完的紀錄**，不是待辦 —— 那句話讀不通。
--
-- 根因：work_status 的預設值是 'open'，對所有 category 一視同仁。
-- AI 分類出的 daily_report（日報）／attendance（出勤・外出）／chitchat（閒聊）
-- 是「紀錄」不是「任務」，卻全部被當成待辦追蹤。
--
-- prod 實查（台灣福祉）：open 的日報 66 筆、出勤 18 筆、閒聊 3 筆；
-- 其中 17 筆已經進到會顯示給員工的清單，涉及 9 個人。
--
-- ⚠️ 為什麼是加一個 work_status 值而不是在每個查詢加 category 過濾：
--    消費端有三處（提醒／結案率／任務看板），各自加過濾的話，
--    第四個消費端出現時一定會漏。把「這不是工作」表達在資料本身，
--    新的查詢只要照常寫 work_status = 'open' 就自動正確。

BEGIN;

-- ⚠️ 有**兩條** CHECK 都只認 open / closed，寫入 'record' 會被擋下來，兩條都要放寬。
--    第一次寫這支 migration 時只改了第二條就以為好了 ——
--    本機 dev 沒有這類資料，跑起來是 UPDATE 0，完全踩不到；
--    是真的插一筆 record 進去的測試才把兩條都逼出來。
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_work_status_check;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_work_status_check
  CHECK (work_status = ANY (ARRAY['open'::text, 'closed'::text, 'record'::text]));

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_work_outcome_matches_status;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_work_outcome_matches_status CHECK (
    (work_status = 'open'   AND work_outcome IS NULL     AND work_closed_at IS NULL) OR
    (work_status = 'closed' AND work_outcome IS NOT NULL AND work_closed_at IS NOT NULL) OR
    -- 紀錄類不進工作生命週期：沒有結束理由、也沒有結束時間，因為它從來沒有「開始」過
    (work_status = 'record' AND work_outcome IS NULL     AND work_closed_at IS NULL)
  );

-- 既有資料回填 · 只動還沒有人處理過的（work_outcome IS NULL）
-- 有人真的標過完成的就不要翻案 —— 那是人的決定
UPDATE tickets
   SET work_status = 'record'
 WHERE category IN ('daily_report', 'attendance', 'chitchat')
   AND work_status = 'open'
   AND work_outcome IS NULL;

COMMENT ON COLUMN tickets.work_status IS
  'open=待確認完成 · closed=已結束 · record=紀錄類（日報／出勤／閒聊），不進工作生命週期，不出現在提醒與結案率';

COMMIT;
