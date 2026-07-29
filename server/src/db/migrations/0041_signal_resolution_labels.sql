-- Migration 0041 · 修 resolution 標籤與實際不符（task-completion-tracking v2.7.1）
--
-- Bug A：**進度回報被標成 closed_ticket**。
--   signal-resolver 的 `!isDone` 分支只更新 work_last_report_*，任務照樣開著，
--   卻標 `closed_ticket`、計數器也叫 `closed`。
--   prod 實況：2 筆 closed_ticket **全部都是 progress** —— 零筆真的關掉任務。
--   這個標籤當場誤導了分析本身（第一眼以為進度回報把任務關掉了）。
--
-- 同 F-26 的紀律：**標籤講的事要跟系統實際知道的事相符**。
--
-- ⚠️ Bug B（任務被刪除後 resolution 仍說接住了）**不在這裡修** ——
--    `resolved_ticket_id` 是 ON DELETE SET NULL，所以「連結還在不在」是可以
--    即時算出來的。存一個 ticket_gone 進 DB 反而要再寫一支同步邏輯，
--    而那支一旦漏跑就又是一組對不上的標籤。改成讀取時推導（見 controller）。

ALTER TABLE pending_completion_signal DROP CONSTRAINT IF EXISTS pcs_resolution_check;
ALTER TABLE pending_completion_signal
  ADD CONSTRAINT pcs_resolution_check CHECK (
    resolution IS NULL OR resolution IN (
      'closed_ticket',      -- 完成訊號 → 真的把任務關掉了
      'progress_logged',    -- 進度回報 → 記了一筆，任務**還開著**
      'created_ticket',     -- 對不到任務，依完成訊號補建
      'no_match',           -- 對不到任何任務（材料化缺口）
      'superseded'          -- 任務已被別的途徑結掉
    )
  );

-- 回填：把標錯的進度回報改回來。
-- 只動「意圖不是完成」的那些 —— 真的由完成訊號關掉的不可誤傷。
--
-- ⚠️ **這段是 no-op，實際回填在 0042。**
--    本表是 FORCE RLS，用 psql 跑 migration 時沒有 app.actor_role，
--    可見列數為 0，於是 `UPDATE 0` —— 而那看起來就像「沒有符合的資料」。
--    留著不刪是為了讓這個錯誤本身有紀錄（0042 的註解說明成因）。
UPDATE pending_completion_signal
   SET resolution = 'progress_logged'
 WHERE resolution = 'closed_ticket'
   AND intent NOT IN ('completion', 'answered_done');

COMMENT ON COLUMN pending_completion_signal.resolution IS
  '訊號的下場 · closed_ticket=關掉了任務 / progress_logged=記了進度但任務還開著 / '
  'created_ticket=補建 / no_match=對不到 / superseded=已被別途徑結掉 · '
  '⚠️ resolved_ticket_id 為 NULL 表示掛到的任務已被刪除，讀取時推導成 ticket_gone';
