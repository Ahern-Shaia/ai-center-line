-- Migration 0040 · 群組 bot 回話開關
--
-- 起因：2026-07-29 客戶群裡，有人把截圖傳進群並回一句「好了」，
-- bot 回了「✓ 已收到完成回報」。那句「好了」講的是「截圖傳好了」。
--
-- ⚠️ 誤判會被**整個群**看到，而群組是客戶的工作現場不是我們的測試場。
-- 在治本（只有對得到任務才回話）之前，客戶至少要有能力把它關掉。
--
-- 這個開關管的是「bot 在這個群裡講不講話」，兩條路徑都吃它：
--   · 引用回覆 → 「已收到完成回報」／「這件算完成了嗎」
--   · 每日回報 → 「尚未確認完成」清單
--
-- ⚠️ 刻意**不沿用 analyze_enabled**。那是「要不要做 AI 分析」，
--    客戶很可能想要分析照跑、只是不要 bot 在群裡出聲 —— 混成一個開關就給不了。
--
-- 預設 true：現行行為不變。要關是客戶自己決定的事（內容層），
-- 我方只負責把開關做出來（權限層）· doc navigation-and-capability-gating §1.4
ALTER TABLE line_group
  ADD COLUMN IF NOT EXISTS reply_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN line_group.reply_enabled IS
  'bot 在這個群裡要不要回話（完成回報確認 / 每日回報清單）· 與 analyze_enabled 是兩件事';
