-- 0065 的前置檢查 —— **套 migration 之前先跑這支**（CLAUDE.md R1：先確認影響範圍）
--
-- 0065 要對 users.email 加兩個約束：
--   ① UNIQUE（不分大小寫）  ② 格式檢查（全 ASCII、一個 @、有網域點、無空白）
--
-- 這兩個都是「既有資料不合就建不起來」的東西。與其在 prod 上看 migration 失敗、
-- 再回頭猜是哪一列，不如先把不合的列撈出來。
--
-- ⚠️ users 有 RLS 且**只認 aiproot_admin**（0001 的 p_users）——
--    沒設就是靜默回 0 列，看起來像「資料很乾淨」，其實是你根本沒看到資料。
--
-- 跑法：render psql ai-center-line-db-demo   然後整段貼進去

SET app.actor_role = 'aiproot_admin';

\echo '───────── ① 總覽 ─────────'
SELECT count(*) AS 帳號總數,
       count(*) FILTER (WHERE email IS NULL) AS email_為NULL,
       count(*) FILTER (WHERE email IS NOT NULL) AS 有email
FROM users;

\echo '───────── ② 重複的 email（不分大小寫）· 有的話 UNIQUE 建不起來 ─────────'
SELECT lower(email) AS email小寫, count(*) AS 幾筆,
       string_agg(user_id::text || ' / ' || coalesce(display_name, '(無顯示名)'), '  |  ') AS 是哪些帳號
FROM users
WHERE email IS NOT NULL
GROUP BY lower(email)
HAVING count(*) > 1;

\echo '───────── ③ 格式不合的 email · 有的話 CHECK 建不起來 ─────────'
-- octet_length <> length ＝ 含非 ASCII（全形＠、中文、全形空白都會被這個抓到）
SELECT user_id, email, display_name, role,
       CASE
         WHEN octet_length(email) <> length(email) THEN '含非 ASCII 字元（可能是全形＠）'
         WHEN email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN '缺 @／缺網域點／含空白／多個 @'
       END AS 不合原因
FROM users
WHERE email IS NOT NULL
  AND (octet_length(email) <> length(email)
       OR email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

\echo '───────── ④ 含大寫的 email · 不擋 migration，但登入是大小寫敏感的 ─────────'
-- 目前 auth.service 是 WHERE email = ? 精確比對。存成大寫的帳號，
-- 使用者打小寫就登不進去 —— 而畫面只會回「帳號或密碼錯誤」。
SELECT user_id, email, display_name, role
FROM users
WHERE email IS NOT NULL AND email <> lower(email);

\echo '───────── ⑤ LIFF 自動建的帳號（@line.local）· 確認它們過得了格式檢查 ─────────'
SELECT count(*) AS line_local_帳號數,
       count(*) FILTER (WHERE octet_length(email) <> length(email)
                          OR email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') AS 其中不合格式的
FROM users
WHERE email LIKE '%@line.local';

\echo ''
\echo '判讀：② ③ 都是 0 列 → 可以直接套 0065。'
\echo '      ② 有資料 → 先決定哪一個帳號留、哪一個改掉或刪掉。'
\echo '      ③ 有資料 → 先把那幾列的 email 修正（多半是全形＠）。'
\echo '      ④ 有資料 → 不影響套用，但那些人現在可能登不進去，值得順手轉小寫。'
