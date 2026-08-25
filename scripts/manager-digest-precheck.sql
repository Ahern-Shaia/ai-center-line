-- 部門主管每日彙總 · 上線前置量測（唯讀）
--
-- ⭐ 這支要回答的是：**這個功能上線後會不會什麼都沒發生？**
--
-- 兩個前置條件，任一不成立就靜默失敗：
--   ① 部門要有 role='group_owner' 的人（沒有專屬「主管」欄位，是靠 role + department_id 查）
--   ② 那位主管要綁了 LINE（沒綁就 push 不出去）
--
-- 同款教訓見 memory project_shipped_but_inert_features：
--   「跑了、沒報錯、什麼都沒發生」—— 而且看起來一切正常。
--
-- 跑法：psql "<PROD_DATABASE_URL>" -f scripts/manager-digest-precheck.sql
--       名稱對不上時 -v tenant='部分名稱'

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
\echo '=== 1. ⭐⭐ 每個部門有沒有主管、主管有沒有綁 LINE ==='
-- 「可收到通知的主管數」是 0 的那些部門，這個功能對它們**完全不會運作**
SELECT d.department_name                                        AS 部門,
       count(DISTINCT u.user_id) FILTER (WHERE u.role = 'group_owner')::int AS 主管人數,
       count(DISTINCT u.user_id) FILTER (
         WHERE u.role = 'group_owner' AND b.user_id IS NOT NULL)::int AS 已綁LINE,
       count(DISTINCT t.ticket_id) FILTER (
         WHERE t.confirm_status IN ('待確認','待簽核'))::int       AS 目前待辦
  FROM departments d
  LEFT JOIN users u ON u.department_id = d.department_id AND u.tenant_id = d.tenant_id
  LEFT JOIN user_line_binding b ON b.user_id = u.user_id AND b.status = 'active'
  LEFT JOIN tickets t ON t.department_id = d.department_id
 WHERE d.tenant_id = :'tid'::uuid
 GROUP BY d.department_id, d.department_name
 ORDER BY 4 DESC;

\echo ''
\echo '=== 2. ⭐ 一句話結論 ==='
-- 「有待辦但收不到通知」的部門數 —— 這個數字大於 0 就代表功能會部分失效
--
-- ⚠️ 全部用 count(DISTINCT ...)：users 與 tickets 兩個 LEFT JOIN 會**笛卡兒相乘**
--    （3 個成員 × 10 張票 = 30 列），不 DISTINCT 的話待辦數會膨脹成人數的倍數。
--    這種錯不會報錯，只會給一個看起來合理的錯數字 —— 而這支腳本存在的意義
--    就是產生一個可以拿來做決定的數字。
WITH d AS (
  SELECT d.department_id,
         count(DISTINCT u.user_id) FILTER (
           WHERE u.role = 'group_owner' AND b.user_id IS NOT NULL)::int AS 可收通知,
         count(DISTINCT t.ticket_id) FILTER (
           WHERE t.confirm_status IN ('待確認','待簽核'))::int           AS 待辦
    FROM departments d
    LEFT JOIN users u ON u.department_id = d.department_id AND u.tenant_id = d.tenant_id
    LEFT JOIN user_line_binding b ON b.user_id = u.user_id AND b.status = 'active'
    LEFT JOIN tickets t ON t.department_id = d.department_id
   WHERE d.tenant_id = :'tid'::uuid
   GROUP BY d.department_id
)
SELECT count(*)::int                                   AS 部門總數,
       count(*) FILTER (WHERE 可收通知 > 0)::int        AS 有主管且已綁LINE,
       count(*) FILTER (WHERE 待辦 > 0 AND 可收通知 = 0)::int AS ⚠️有待辦但沒人收得到,
       sum(待辦) FILTER (WHERE 可收通知 = 0)::int        AS ⚠️收不到的待辦張數
  FROM d;

\echo ''
\echo '=== 3. 每天大約會發幾則（＝ push 計費量）==='
-- 一天一則 × 有主管的部門數。若這裡算出來每天 >20 則，要重新想彙總的顆粒度
SELECT to_char(t.created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') AS 月份,
       count(*)::int                                                  AS 當月新任務,
       round(count(*)::numeric / 30, 1)                               AS 平均每天
  FROM tickets t
 WHERE t.tenant_id = :'tid'::uuid
   AND t.created_at >= now() - interval '3 months'
 GROUP BY 1 ORDER BY 1;
