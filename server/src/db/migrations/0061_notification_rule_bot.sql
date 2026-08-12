-- 0061_notification_rule_bot.sql — 通知規則綁定「用哪支 LINE bot 發送」
-- 冪等：可重跑
--
-- 背景（docs/modules/notify-bot-scoped-target.md）：
-- 規則原本不知道要用哪支 bot 發，於是靠兩層猜測：
--   ① rule.tenant_id 為 NULL → 退回全域 env LINE_CHANNEL_ACCESS_TOKEN
--   ② 有 tenant_id 時 → 取「該租戶最新建立的 active bot」（ORDER BY created_at DESC LIMIT 1）
--
-- 而 LINE 的**群組 ID 是依 bot（provider）發放**的，兩者對不上就是 400，
-- 且 LINE 只回一句沒有資訊量的 "Failed to send messages"。
--
-- 2026-08-12 prod 實際發生：鮮湧的報價單規則指向鮮湧AI客服的群，
-- 卻用全域 token 那支 bot 發送 → 400。同批其他四條沒事，只因為它們的目標群
-- 剛好是全域那支 bot 所在的群 —— 那是碰巧，不是設計。
--
-- ⚠️ 刻意 nullable：既有規則還沒有 bot_id，設 NOT NULL 會讓現在會動的通知全部停擺。
--    補完資料（見 doc §6）後才可考慮收緊。
-- ⚠️ ON DELETE RESTRICT：bot 被刪掉時不可以讓規則悄悄變回「猜」的狀態，
--    要擋下來逼人明確處理。

BEGIN;

ALTER TABLE notification_rule
  ADD COLUMN IF NOT EXISTS bot_id uuid REFERENCES line_bot(bot_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_notification_rule_bot ON notification_rule(bot_id);

COMMENT ON COLUMN notification_rule.bot_id IS
  '用哪支 LINE bot 發送 · NULL=舊資料（會退回猜測，見 0061 說明）· 群組 ID 依 bot 發放，兩者必須同一支';

COMMIT;
