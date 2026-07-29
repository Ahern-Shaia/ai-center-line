-- Migration 0046 · 私訊回報完成（task-assign-notify M2）
--
-- 0045 讓主管指派後可以私訊當事人，但文案叫他「去群組裡引用訊息回一句好了」。
-- 那是一條死路：完成訊號的接收只掛在**群組**分支（line-webhook.service.ts:210），
-- 私訊分支完全沒有接。他在私訊回「好了」，bot 會答「✓ 已記錄」，
-- 任務不會被關掉 —— **而他以為自己回報過了**。
--
-- 這版把回報收回私訊本身：一對一時「是誰」永遠確定，缺的只有「哪一張」。

-- ── 推播出去那則訊息的 id ──────────────────────────────────────
-- 他若直接「回覆」我們那則通知，quotedMessageId 就是這個值 → 精準對到那一張，
-- 一個判斷都不用做（快路徑）。
--
-- ⚠️ 可為 NULL 且**必須容忍 NULL**：LINE push API 回不回 sentMessages[].id
--    我們沒有實測過（兩支 client 原本都直接丟棄回應）。拿不到就退回慢路徑
--    （列出他手上開著的任務問哪一件），功能不會壞，只是多問一次。
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS assign_notify_message_id text;

COMMENT ON COLUMN tickets.assign_notify_message_id IS
  '指派通知推播出去那則的 LINE messageId · 當事人回覆它時可精準對回這張票 · NULL = LINE 沒回傳 id，走慢路徑';

-- ── 對到多張時不可以偷偷挑一張 ─────────────────────────────────
-- signal-resolver 原本是 `ORDER BY created_at DESC LIMIT 1`：同一則訊息若被
-- 抽成兩筆記錄（source_message_ids 重疊），就會**靜默關掉比較新的那一張**。
-- prod 現況查過是 1:1（71 則來源訊息無一對到兩張），所以還沒發生 ——
-- 但擋不住，而它發生時的樣子跟正常關閉完全一樣，沒有人會發現。
ALTER TABLE pending_completion_signal DROP CONSTRAINT IF EXISTS pcs_resolution_check;
ALTER TABLE pending_completion_signal ADD CONSTRAINT pcs_resolution_check CHECK (
  resolution IS NULL OR resolution IN (
    'closed_ticket', 'progress_logged', 'created_ticket', 'no_match', 'superseded', 'ambiguous'
  )
);

COMMENT ON COLUMN pending_completion_signal.resolution IS
  '訊號的下場 · ambiguous = 對到多張任務，刻意不動狀態，留給後台的未接住清單處理';
