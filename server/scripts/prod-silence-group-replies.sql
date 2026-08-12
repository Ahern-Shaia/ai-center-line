-- 關掉所有群組的「bot 回話」開關（2026-08-12 用戶裁定：LINE 群組一律不出聲）
--
-- 為什麼程式碼已經註解掉了還要做這個：
--   · 縱深防禦 —— 哪天有人把註解取消，群組仍然是安靜的，要出聲得明確開
--   · 讓資料狀態與意圖一致 —— 現在後台那個開關全是「開」，看起來像 bot 會講話
--
-- ⚠️ 這只關「bot 出不出聲」，**不影響 AI 分析**（analyze_enabled 是另一欄）。
--    訊息照樣落庫、照樣分析、照樣進日報與任務看板。
--
-- 跑法（prod 寫入必須用 bare psql，prod-query.sh 是唯讀的）：
--   psql "$PROD_DATABASE_URL" -f server/scripts/prod-silence-group-replies.sql

BEGIN;

SELECT set_config('app.actor_role', 'aiproot_admin', true);

-- 動手前先看現況
SELECT reply_enabled AS 目前回話開關, count(*) AS 群數
  FROM line_group GROUP BY 1 ORDER BY 1;

-- 全部關掉（含非 active 的 —— 免得群組復活時又開始講話）
UPDATE line_group SET reply_enabled = false
 WHERE reply_enabled = true;

-- 確認：應該只剩 false 一列
SELECT reply_enabled AS 改完回話開關, count(*) AS 群數
  FROM line_group GROUP BY 1 ORDER BY 1;

COMMIT;

-- ── 要開回來的話（單一群組）──────────────────────────────
-- BEGIN;
-- SELECT set_config('app.actor_role', 'aiproot_admin', true);
-- UPDATE line_group SET reply_enabled = true
--  WHERE group_id = 'Cxxxxxxxx' RETURNING group_id, display_name, reply_enabled;
-- COMMIT;
