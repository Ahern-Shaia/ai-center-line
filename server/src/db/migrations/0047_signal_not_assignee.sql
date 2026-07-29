-- Migration 0047 · 群組完成回報補當責人檢查（task-completion-tracking）
--
-- signal-resolver 關票時的條件只有 `WHERE ticket_id = ...`，**完全不檢查回報者是誰**。
-- 群裡任何人引用一則任務訊息說「已完成」，那張票就關了，即使它是別人的。
-- 私訊那條路有 assignee_user_id 把關，群組這條沒有 —— 兩條路的嚴格程度不一致，
-- 而且這件事沒有寫在任何地方。
--
-- ⚠️ 但**不可以**一律要求「回報者＝當責人」：
-- prod 45 張任務裡有 38 張根本沒有當責人（unclaimed 24 ＋ none 14），
-- 而目前 10 筆待處理訊號指到的票**全部**是這種。一律檢查等於讓它們永遠關不掉。
--
-- 所以規則是：**票有當責人時才檢查，沒有當責人時維持現狀（誰回報都算）。**
-- 今天的實際影響是 0 筆 —— 這是純防護，不動現行流程。

ALTER TABLE pending_completion_signal DROP CONSTRAINT IF EXISTS pcs_resolution_check;
ALTER TABLE pending_completion_signal ADD CONSTRAINT pcs_resolution_check CHECK (
  resolution IS NULL OR resolution IN (
    'closed_ticket',    -- 完成訊號 → 真的把任務關掉了
    'progress_logged',  -- 進度回報 → 記了一筆，任務還開著
    'created_ticket',   -- 對不到任務，依完成訊號補建
    'no_match',         -- 對不到任何任務（材料化缺口）
    'superseded',       -- 任務已被別的途徑結掉
    'ambiguous',        -- 一則訊息對到多張任務 · 刻意不動狀態
    'not_assignee'      -- 0047 · 回報的人不是當責人 · 記進度但不關票
  )
);

COMMENT ON COLUMN pending_completion_signal.resolution IS
  '訊號的下場 · ambiguous = 對到多張任務 · not_assignee = 回報者不是當責人 · 兩者都刻意不關票，留給後台的未接住清單';
