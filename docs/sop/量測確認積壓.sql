-- 量測「確認動作」的積壓 · 決定要不要做確認佇列收斂（four-features-reflection §6 / OQ-4FR-5）
--
-- 為什麼是 SQL 不是先做儀表：
-- 要決定的是「該不該做 A（確認佇列）」。為了決定這件事而先做 B（量測儀表），
-- 是把成本花在還沒確定要不要的功能上。資料全都在 DB，一句查詢就有。
--
-- 建議跑法：**每週一次**，把數字記下來，連續看三到四週。
-- 單看一次的數字沒有意義 —— 要看的是趨勢與「有沒有人在處理」。
--
-- ⚠️ 判讀的重點不是「積了幾筆」，是「**有沒有人在處理**」。
--    積壓有兩種完全不同的成因，解法相反：
--      ① 有人在處理但入口太分散、漏看 → 確認佇列會有幫助
--      ② 根本沒人進來用            → 做佇列也沒人看，該解的是導入
--    §3 就是用來分辨這兩者的。

SET app.actor_role = 'aiproot_admin';
SET app.current_tenant = '4d97eced-64c5-4a38-952b-dfce9588ab7c';   -- 台灣福祉

-- ============================================================
-- 1 · 四種確認各積了多少
-- ============================================================
SELECT '任務待簽核' AS 類型, count(*) AS 積壓數,
       max(now()::date - created_at::date) AS 最久幾天
FROM tickets WHERE confirm_status = '待簽核'
UNION ALL
SELECT '任務待確認（中信心）', count(*),
       max(now()::date - created_at::date)
FROM tickets WHERE confirm_status = '待確認'
UNION ALL
SELECT '日報未送出', count(*),
       max(now()::date - report_date)
FROM personal_daily_report WHERE status <> 'sent';
-- 里程申訴尚未實作（attendance-location-mileage M3 · DEFERRED），故不列

-- ============================================================
-- 2 · 積壓的年齡分布（幾筆躺了幾天）
-- 全部集中在「很舊」代表沒人處理；分散代表有人在跟但跟不完
-- ============================================================
SELECT (now()::date - created_at::date) AS 躺幾天, count(*) AS 張數
FROM tickets WHERE confirm_status IN ('待簽核', '待確認')
GROUP BY 1 ORDER BY 1 DESC;

-- ============================================================
-- 3 · ⭐ 有沒有人在處理（這一段比積壓數重要）
--
-- 如果最後一次簽核／送出是很久以前，那就不是「入口太分散」的問題，
-- 是客戶根本還沒開始用 —— 做確認佇列不會有人看。
-- ============================================================
SELECT '簽核' AS 動作, max(confirmed_at)::date AS 最後一次,
       count(DISTINCT confirmed_at::date) AS 總共幾天有動作
FROM tickets WHERE confirmed_at IS NOT NULL
UNION ALL
SELECT '日報送出', max(sent_at)::date, count(DISTINCT sent_at::date)
FROM personal_daily_report WHERE sent_at IS NOT NULL;

-- ============================================================
-- 4 · 中信心票有沒有開始產生
--
-- 分區功能 2026-07-28 才上線。在那之前跑的分析不會產生「待確認」。
-- 若下面查到 0，代表新程式碼上線後還沒跑過群組分析，**現在量不到**，
-- 要等排程跑過再回來量。
-- ============================================================
SELECT count(*) FILTER (WHERE confirm_status = '待確認') AS 待確認張數,
       max(created_at)                                   AS 最新任務建立時間,
       (SELECT max(uploaded_at) FROM analysis_upload WHERE status = 'done') AS 最後一次群組分析
FROM tickets;

-- ============================================================
-- 判讀指引
-- ============================================================
-- 做確認佇列（§6）：
--   · §3 顯示最近仍有簽核／送出動作（有人在用）
--   · 而且 §1 的積壓持續累積、§2 的年齡往上跑
--   → 代表人有在做但漏看，收斂入口會有效
--
-- 不要做，先解導入：
--   · §3 顯示最後一次動作是很久以前、或總共只有一兩天有動作
--   → 沒有人進來，做佇列也沒人看
--
-- 也不要做：
--   · §1 每天只有個位數且很快被清掉 → 現在的分散入口就夠用了
