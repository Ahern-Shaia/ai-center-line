-- 會議記錄實況探查 · 唯讀 · 不改任何資料
--
-- 用途：判斷「會議記錄裡到底有沒有可以變成待辦的決議」——
--       這是 OQ-MD-1 的關鍵，決定要不要做 docs/modules/meeting-decisions.md 的 B 案。
--
-- 跑法：psql "<PROD_DATABASE_URL>" -f scripts/meeting-probe.sql
--       （不需要填任何東西，tenant_id 自己抓）
--
-- ⚠️⚠️ v1 這支自己踩了它檔頭在警告的那個坑：查 tenants 的那段寫在 SET **之前**，
--      於是 policy 兩邊都不成立 → 靜默回 0 列 → tenant_id 抓不到 → 後面三段全空。
--      看起來像「客戶根本沒開會」，實際上是我們沒設 session 變數。
--
-- 實際 policy（本機 pg_policies 查證 2026-08-25）：
--   tenants       : tenant_id = current_tenant OR actor_role = 'aiproot_admin'
--   line_message  : tenant_id = current_tenant OR actor_role IN (aiproot_admin, consultant, system)
--   tickets       : tenant_id = current_tenant AND (current_department 為空 OR department_id = 它)
--                   ⭐ **AND-only · 沒有平台角色的逃生門** —— current_tenant 一定要是真的值

\pset pager off
-- ⭐ 一定要 on：抓不到 tenant_id 時要**當場停下來**。
--    v1 的致命之處不是抓不到，是抓不到之後**繼續跑**，印出一整排 0 列 ——
--    看起來像「客戶沒開會」，實際上是我們沒設對變數。
--    寧可整支中斷，也不要產出會被誤讀的空表。
\set ON_ERROR_STOP on

-- ── 0. 先設 session 變數（一定要在任何 SELECT 之前）──────────────
SET app.actor_role = 'aiproot_admin';
SET app.current_department = '';     -- 空＝不限部門（tickets policy 的第二段）

\echo ''
\echo '=== 診斷：session 變數（三個都要有值，current_tenant 稍後才設）==='
SELECT current_setting('app.actor_role', true)         AS actor_role,
       current_setting('app.current_department', true) AS current_department,
       current_user                                     AS 連線角色;

\echo ''
\echo '=== 1. 有哪些租戶（設好 actor_role 才看得到 · v1 就是漏了這步）==='
SELECT tenant_id, tenant_name FROM tenants ORDER BY tenant_name;

-- ── 抓 tenant_id 塞進 psql 變數 ─────────────────────────────────
-- 名稱對不上時用 -v tenant='部分名稱' 覆寫，例：
--   psql "<URL>" -v tenant='福祉' -f scripts/meeting-probe.sql
\if :{?tenant}
\else
  \set tenant 福祉
\endif

-- 抓不到會是 `no rows returned for \gset` 並因 ON_ERROR_STOP 中斷 —— 那正是我們要的
SELECT tenant_id AS tid
  FROM tenants
 WHERE tenant_name LIKE '%' || :'tenant' || '%'
 ORDER BY tenant_name
 LIMIT 1 \gset

\echo ''
\echo '>>> 抓到的 tenant_id：'
\echo :tid

SET app.current_tenant = :'tid';

\echo ''
\echo '=== 2. ⭐ RLS 護欄：這個租戶總共有多少票 ==='
-- **這裡是 0 的話，下面所有的 0 都沒有意義** —— 是 RLS 沒通，不是客戶沒開會。
-- tickets 的 policy 是 AND-only（沒有平台角色的逃生門），current_tenant 錯了就全空。
SELECT count(*)::int AS 全部票數,
       count(*) FILTER (WHERE confirm_status = '存查')::int AS 存查,
       count(*) FILTER (WHERE confirm_status = '待簽核')::int AS 待核對
  FROM tickets;

\echo ''
\echo '=== 3. 有多少「像會議」的任務 · 落在哪一區 ==='
SELECT t.category, t.confirm_status, t.status, count(*)::int AS n
  FROM tickets t
 WHERE t.category ILIKE '%meeting%' OR t.category LIKE '%會議%'
    OR t.summary LIKE '%會議%' OR t.summary LIKE '%開會%'
    OR t.summary LIKE '%週會%' OR t.summary LIKE '%會報%'
 GROUP BY 1,2,3
 ORDER BY n DESC;

\echo ''
\echo '=== 4. 這些任務的摘要長什麼樣（最近 15 筆）==='
SELECT to_char(t.created_at AT TIME ZONE 'Asia/Taipei', 'MM/DD') AS 日期,
       t.category, t.confirm_status, t.status,
       left(t.summary, 90) AS 摘要
  FROM tickets t
 WHERE t.category ILIKE '%meeting%' OR t.summary LIKE '%會議%'
    OR t.summary LIKE '%開會%' OR t.summary LIKE '%週會%'
 ORDER BY t.created_at DESC
 LIMIT 15;

\echo ''
\echo '=== 5. 提到「會議」的訊息有幾則、在哪些群（先看有沒有東西可看）==='
SELECT m.group_id,
       coalesce(g.display_name, '(未命名)') AS 群組,
       count(*)::int AS 提到會議的訊息數,
       to_char(max(m.sent_at) AT TIME ZONE 'Asia/Taipei', 'MM/DD') AS 最近一次
  FROM line_message m
  LEFT JOIN line_group g ON g.group_id = m.group_id
 WHERE m.tenant_id = :'tid'::uuid
   AND m.message_type = 'text'
   AND (m.text_content LIKE '%會議%' OR m.text_content LIKE '%開會%'
        OR m.text_content LIKE '%週會%' OR m.text_content LIKE '%會報%')
 GROUP BY 1,2
 ORDER BY 3 DESC;

\echo ''
\echo '=== 6. ⭐⭐ 決定性的一段：會議前後的原始對話全文 ==='
-- 要看的是：群裡的「會議」是「通知大家幾點開會」，還是真的把討論打在群裡？
-- 如果有討論，裡面有沒有「誰要做什麼」這種可以變成待辦的句子？
--
--   「下午2點開會」「收到」            → 沒有決議可抽，選 A（加一個分類就結案，不寫程式）
--   「決議：A 追報價、B 週五前回覆」   → B 值得做，客戶的抱怨完全成立
--
-- 抓法：找出提到會議的訊息，連同它前後 30 分鐘的同群訊息一起列出來
WITH anchor AS (
  SELECT group_id, sent_at
    FROM line_message
   WHERE tenant_id = :'tid'::uuid
     AND message_type = 'text'
     AND (text_content LIKE '%會議%' OR text_content LIKE '%開會%'
          OR text_content LIKE '%週會%' OR text_content LIKE '%會報%')
   ORDER BY sent_at DESC
   LIMIT 5
)
SELECT to_char(m.sent_at AT TIME ZONE 'Asia/Taipei', 'MM/DD HH24:MI') AS 時間,
       coalesce(g.display_name, '?') AS 群組,
       coalesce(lm.display_name, '?') AS 發話者,
       left(m.text_content, 140) AS 內容
  FROM line_message m
  JOIN anchor a ON a.group_id = m.group_id
               AND m.sent_at BETWEEN a.sent_at - interval '30 minutes'
                                 AND a.sent_at + interval '30 minutes'
  LEFT JOIN line_group g ON g.group_id = m.group_id
  LEFT JOIN line_member lm ON lm.group_id = m.group_id AND lm.user_id = m.sender_line_id
 WHERE m.tenant_id = :'tid'::uuid
   AND m.message_type = 'text'
 GROUP BY 1,2,3,4, m.sent_at
 ORDER BY m.sent_at DESC
 LIMIT 150;
