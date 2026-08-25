-- 把 08-24 中英混雜殘留的 `production_meeting` 收斂成內建的 `meeting`（會議記錄）
--
-- 背景：內建分類清單原本沒有「會議」，模型看到生產會議的決議事項無處可歸，
--       就自己造了英文 slug。prompt 已修（往後不會再造英文），內建清單也補上 meeting，
--       但**已經存下來的 ticket.category 仍是英文** —— 這支就是修那些。
--
-- 跑法（預設乾跑，只看不改）：
--   psql "<PROD_DATABASE_URL>" -f scripts/meeting-category-fix.sql
-- 真的要寫入：
--   psql "<PROD_DATABASE_URL>" -v apply=1 -f scripts/meeting-category-fix.sql
--
-- ⚠️⚠️ **只動 category，絕不碰 confirm_status / work_status。**
--    那 9 張裡有 6 張在「待確認」、2 張在「待簽核」—— 那是人動過或等人動的決定。
--    動到它就是**翻案**（同 RECOMPUTABLE_LANES 的紀律：人動過的區不可被重算）。

\pset pager off
\set ON_ERROR_STOP on

SET app.actor_role = 'aiproot_admin';
SET app.current_department = '';

\if :{?tenant}
\else
  \set tenant 福祉
\endif

SELECT tenant_id AS tid FROM tenants
 WHERE tenant_name LIKE '%' || :'tenant' || '%'
 ORDER BY tenant_name LIMIT 1 \gset

SET app.current_tenant = :'tid';

\echo ''
\echo '=== 0. RLS 護欄（是 0 的話下面全部沒有意義）==='
SELECT count(*)::int AS 這個租戶的票數 FROM tickets;

\echo ''
\echo '=== 1. ⭐ 還有哪些英文 slug 分類（08-24 事件的全貌）==='
-- 客戶現在在畫面上看到的是「其他（production meeting）」這種 ——
-- 前端 catLabel 有 fallback，所以不會直接秀 slug，但仍然看得出是英文。
-- ⚠️ 這一段只是**盤點**：production_meeting 以外的 slug 要叫什麼中文名，
--    得先看它們的內容再決定，不在這支裡猜。
SELECT category, count(*)::int AS n,
       left(string_agg(DISTINCT summary, ' ／ '), 120) AS 例子
  FROM tickets
 WHERE category ~ '^[a-z0-9_]+$'
   AND category NOT IN ('daily_report','attendance','maintenance','rnd',
                        'procurement','sales','it_support','chitchat','meeting')
 GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== 2. 這次要改的（production_meeting）· 改動前 ==='
SELECT confirm_status, work_status, count(*)::int AS n
  FROM tickets WHERE category = 'production_meeting'
 GROUP BY 1,2 ORDER BY 3 DESC;

\if :{?apply}
  \echo ''
  \echo '>>> 寫入中…'
  BEGIN;
  -- ⭐ SET 子句**只有 category**。多寫任何一個欄位都是翻案。
  UPDATE tickets
     SET category = 'meeting'
   WHERE category = 'production_meeting';
  \echo '>>> 影響列數見上方 UPDATE 的輸出'
  COMMIT;

  \echo ''
  \echo '=== 3. 改動後 · 分區必須跟改動前一模一樣 ==='
  SELECT confirm_status, work_status, count(*)::int AS n
    FROM tickets WHERE category = 'meeting'
   GROUP BY 1,2 ORDER BY 3 DESC;

  \echo ''
  \echo '=== 4. 確認沒有殘留 ==='
  SELECT count(*)::int AS 還剩幾張_production_meeting
    FROM tickets WHERE category = 'production_meeting';
\else
  \echo ''
  \echo '>>> 乾跑：沒有寫入任何東西。'
  \echo '>>> 確認上面第 2 段的分區分布，再加 -v apply=1 重跑。'
  \echo '>>> 改完之後第 3 段的分布**必須跟第 2 段完全一樣** —— 不一樣就是動到不該動的欄位。'
\endif
