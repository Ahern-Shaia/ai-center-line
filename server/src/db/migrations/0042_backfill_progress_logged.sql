-- Migration 0042 · 補跑 0041 的回填（0041 的 UPDATE 是 no-op）
--
-- ⚠️ 0041 的 `UPDATE pending_completion_signal ...` **一筆都沒改到**，而且不報錯。
--
-- 成因：`pending_completion_signal` 是 FORCE RLS，policy `pcs_rw` 要求
--   `app.actor_role IN ('aiproot_admin','system')` 或 tenant 相符。
-- 用 psql 直接跑 migration 時兩個 session 變數都沒設 → 可見列數為 0 → `UPDATE 0`。
-- 而 `UPDATE 0` 看起來就像「沒有符合條件的資料」，跟「真的沒有」完全分不出來
-- （本專案第 10 次踩 RLS 靜默回 0）。
--
-- ⭐ 結論：**任何動到 FORCE RLS 表的 migration DML，都要先 SET LOCAL app.actor_role**。
--    純 DDL（ALTER TABLE / CREATE POLICY）不受影響，所以 0041 的約束部分是有生效的。
BEGIN;

SET LOCAL app.actor_role = 'system';

UPDATE pending_completion_signal
   SET resolution = 'progress_logged'
 WHERE resolution = 'closed_ticket'
   AND intent NOT IN ('completion', 'answered_done');

COMMIT;
