-- 會議記錄實況探查 · 台灣福祉（唯讀 · 不改任何資料）
-- 用途：判斷「會議記錄裡到底有沒有可以變成待辦的決議」——
--       這是 OQ-TWH-9 的關鍵，決定要不要改抽取顆粒度。
--
-- ⚠️ RLS：tickets / line_message 都是 AND-only，少設 current_tenant 會**靜默回 0 列**
--    （不是報錯，是回空的 —— 已踩 10 次）。所以下面每段都先 SET。
--
-- 跑法：psql "<PROD_DATABASE_URL>" -f meeting-probe.sql

\echo '=== 0. 台灣福祉的 tenant_id ==='
SELECT tenant_id, tenant_name FROM tenants WHERE tenant_name LIKE '%福祉%';

-- ⬇⬇ 把上面查到的 tenant_id 填進來，其餘三段都吃它 ⬇⬇
\set TID '00000000-0000-0000-0000-000000000000'

SET app.actor_role = 'aiproot_admin';
SET app.current_tenant = :'TID';
SET app.current_department = '';

\echo ''
\echo '=== 1. 有多少「像會議」的任務 · 分別落在哪一區 ==='
-- 看數量級：如果只有個位數，顆粒度這件事就不急
SELECT t.category,
       t.confirm_status,
       t.status,
       count(*)::int AS n
  FROM tickets t
 WHERE t.tenant_id = :'TID'::uuid
   AND (t.category ILIKE '%meeting%' OR t.category LIKE '%會議%'
        OR t.summary LIKE '%會議%' OR t.summary LIKE '%開會%'
        OR t.summary LIKE '%週會%' OR t.summary LIKE '%會報%')
 GROUP BY 1,2,3
 ORDER BY n DESC;

\echo ''
\echo '=== 2. 這些任務的摘要長什麼樣（最近 15 筆）==='
-- 判斷 AI 現在把「一場會」抽成什麼：是「今天下午開會」還是已經含決議內容
SELECT to_char(t.created_at AT TIME ZONE 'Asia/Taipei', 'MM/DD') AS 日期,
       t.category, t.confirm_status, t.status,
       left(t.summary, 90) AS 摘要
  FROM tickets t
 WHERE t.tenant_id = :'TID'::uuid
   AND (t.category ILIKE '%meeting%' OR t.summary LIKE '%會議%'
        OR t.summary LIKE '%開會%' OR t.summary LIKE '%週會%')
 ORDER BY t.created_at DESC
 LIMIT 15;

\echo ''
\echo '=== 3. ⭐ 最關鍵：會議當下的原始對話全文（最近 3 天，各 40 則）==='
-- 這一段才是決定性的。要看的是：
--   · 群裡的「會議」是「通知大家幾點開會」，還是真的把討論打在群裡？
--   · 如果有討論，裡面有沒有「誰要做什麼」這種可以變成待辦的句子？
--
-- 若只是「下午2點會議室」→ 顆粒度改了也抽不出東西，答案是「當成分類存起來就好」
-- 若有「決議：A 追報價、B 週五前回覆」→ 顆粒度改造值得做
SELECT to_char(m.sent_at AT TIME ZONE 'Asia/Taipei', 'MM/DD HH24:MI') AS 時間,
       coalesce(lm.display_name, '?') AS 發話者,
       left(m.text_content, 120) AS 內容
  FROM line_message m
  LEFT JOIN line_member lm ON lm.group_id = m.group_id AND lm.user_id = m.sender_line_id
 WHERE m.tenant_id = :'TID'::uuid
   AND m.message_type = 'text'
   AND m.group_id IN (
        SELECT DISTINCT group_id FROM line_message
         WHERE tenant_id = :'TID'::uuid AND message_type = 'text'
           AND (text_content LIKE '%會議%' OR text_content LIKE '%開會%')
       )
   AND m.sent_at >= now() - interval '3 days'
 ORDER BY m.group_id, m.sent_at
 LIMIT 120;
