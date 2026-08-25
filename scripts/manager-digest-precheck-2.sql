-- 前測第二段 · 分清楚「真的沒有主管」還是「查詢把他們濾掉了」（唯讀）
--
-- 背景：precheck 第 1 段顯示 13 個部門的主管人數**全部是 0**。
--       真實資料很少這麼整齊 —— 在據此做決定之前要先排除量測錯誤
--       （memory pitfall_green_because_empty：綠燈的原因常是「什麼都沒跑到」）。
--
-- 跑法：psql "<PROD_DATABASE_URL>" -f scripts/manager-digest-precheck-2.sql

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
\echo '=== 1. ⭐ 這個租戶到底有哪些帳號（不篩角色、不篩部門）==='
-- 這裡如果是 0，代表 users 也被 RLS 擋住了 → precheck 的 0 是量測錯誤
-- ⚠️ count(DISTINCT) —— 一個人可能綁多個 bot，不 DISTINCT 會把人數灌大
SELECT count(DISTINCT u.user_id)::int                                       AS 帳號總數,
       count(DISTINCT u.user_id) FILTER (WHERE u.department_id IS NOT NULL)::int AS 有指定部門,
       count(DISTINCT u.user_id) FILTER (WHERE b.user_id IS NOT NULL)::int  AS 已綁LINE
  FROM users u
  LEFT JOIN user_line_binding b ON b.user_id = u.user_id AND b.status = 'active'
 WHERE u.tenant_id = :'tid'::uuid;

\echo ''
\echo '=== 2. ⭐⭐ 按角色拆開 · 決定性的一段 ==='
-- 「group_owner」那一列如果是 0，就是**真的沒有部門主管帳號**，
-- 那 manager-daily-digest 現在做出來對誰都不會發 —— 該先做的是建帳號，不是這個功能。
SELECT coalesce(u.role, '(null)')                                            AS 角色,
       count(DISTINCT u.user_id)::int                                        AS 人數,
       count(DISTINCT u.user_id) FILTER (WHERE u.department_id IS NOT NULL)::int AS 有指定部門,
       count(DISTINCT u.user_id) FILTER (WHERE b.user_id IS NOT NULL)::int   AS 已綁LINE,
       left(string_agg(DISTINCT u.display_name, '、'), 100)                  AS 有誰
  FROM users u
  LEFT JOIN user_line_binding b ON b.user_id = u.user_id AND b.status = 'active'
 WHERE u.tenant_id = :'tid'::uuid
 GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== 3. 自訂角色（role_id）有沒有人在用 ==='
-- 08-21 上線的自訂角色：能力走 role_id、資料範圍走 role。
-- 如果客戶用自訂角色當「部門主管」，role 欄位可能不是 group_owner ——
-- 那 precheck 只看 role='group_owner' 就會漏掉他們。
SELECT coalesce(r.role_name, '(未指定自訂角色)')     AS 自訂角色,
       coalesce(r.baseline_role, '—')                AS 資料範圍基準,
       count(DISTINCT u.user_id)::int                AS 人數
  FROM users u
  LEFT JOIN roles r ON r.role_id = u.role_id
 WHERE u.tenant_id = :'tid'::uuid
 GROUP BY 1,2 ORDER BY 3 DESC;

\echo ''
\echo '=== 4. 誰綁了 LINE（有綁的才可能收得到通知）==='
SELECT u.display_name AS 姓名, u.role AS 角色,
       coalesce(d.department_name, '(沒有部門)') AS 部門,
       to_char(max(b.bound_at) AT TIME ZONE 'Asia/Taipei', 'MM/DD') AS 綁定日
  FROM users u
  JOIN user_line_binding b ON b.user_id = u.user_id AND b.status = 'active'
  LEFT JOIN departments d ON d.department_id = u.department_id
 WHERE u.tenant_id = :'tid'::uuid
 GROUP BY 1,2,3
 ORDER BY 2, 1;
