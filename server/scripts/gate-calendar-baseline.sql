-- calendar-sync M3 · 上線前基準線與分母量測（**唯讀**）
--
-- 跑法：render psql <db>   然後整段貼進去
--
-- ⚠️⚠️ 這支**回答不了 gate 的主問題**（「due_at 抽得到多少」）。
--    那個問題 SQL 問不出來，因為 prod 現有的 analysis_result.records 全部是
--    **舊 prompt** 產出的，裡面根本沒有 due_at 這個 key ——
--    去數它一定是 0，而那個 0 的意思是「還沒跑過」不是「抽不到」。
--    抽取率要跑 scripts/gate-due-at-rate.ts（要打 LLM，SQL 做不到）。
--
--    這支回答的是三件 SQL 答得出來、而且**要在上線前先有數字**的事：
--      ① 基準線：due_at 現在真的是 100% null 嗎（我的前提對不對）
--      ② 分母：最近的對話裡到底有沒有東西可抽（沒有的話整個功能都要重想）
--      ③ 逾時基準線：現在有幾張逾時卡（上線後要拿來對照）
--
-- ⚠️ tickets 有 RLS 且 **沒有平台角色逃生門**（0001 p_tickets 是 AND 條件）：
--    沒設 app.current_tenant 就是靜默回 0 列、不報錯。
--    所以動 tickets 的段落一律走 DO 迴圈逐租戶設變數，
--    而且**跑完會自我檢查**：加總是 0 就明講「這是沒看到資料，不是沒有資料」。

\set ON_ERROR_STOP on

-- ⚠️ 這行漏不得。`tenants` 自己也有 RLS（0001 p_tenants），沒設就是回 0 列 ——
--    然後下面逐租戶的迴圈會跑 0 圈、加總 0 張卡，看起來像「prod 沒資料」。
--    第一版就是漏了這行，本機跑出來 0 個租戶。
-- ⚠️ 這**不會**讓 tickets 越界：p_tickets 仍要求 tenant_id = app.current_tenant，
--    actor_role 只影響 group_owner 的部門限縮那一支。
SET app.actor_role = 'aiproot_admin';

\echo ''
\echo '═════════ ⓪ 護欄：確認連對庫、而且 RLS 行為符合預期 ═════════'

-- ⚠️⚠️ 沒設 current_tenant 時 tickets 必須回 0。
--    回不是 0 就代表這個連線**繞過了 RLS**（owner 且沒 FORCE RLS，或有 BYPASSRLS）——
--    那下面逐租戶的迴圈會**每一圈都數到全部卡片**，加總變成「租戶數 × 總卡數」，
--    而且完全不會報錯。這種錯的數字比沒有數字糟，所以直接停。
DO $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('app.current_tenant', '', true);
  SELECT count(*) INTO n FROM tickets;
  IF n <> 0 THEN
    RAISE EXCEPTION '未設租戶卻看得到 % 張卡片 —— 這個連線繞過了 RLS，'
      '逐租戶的加總會重複計算。換一個不繞過 RLS 的角色再跑。', n;
  END IF;
  RAISE NOTICE '  RLS 正常（未設租戶時看不到任何卡片）';
END $$;

SELECT count(*) AS 租戶數, count(*) FILTER (WHERE tenant_name IS NOT NULL) AS 有名稱 FROM tenants;
SELECT count(*) AS 分析結果筆數,
       count(*) FILTER (WHERE messages IS NOT NULL) AS 有訊息內容
FROM analysis_result;

\echo ''
\echo '═════════ ① 基準線：due_at 現在是不是 100% null ═════════'
\echo '（我的前提是「在此之前從沒寫過」。前提錯的話後面的判斷全部要重來。）'

DO $$
DECLARE
  t RECORD;
  n_all bigint; n_due bigint;
  sum_all bigint := 0; sum_due bigint := 0;
BEGIN
  FOR t IN SELECT tenant_id, coalesce(tenant_name, tenant_id::text) AS name FROM tenants ORDER BY 2 LOOP
    PERFORM set_config('app.current_tenant', t.tenant_id::text, true);
    SELECT count(*), count(*) FILTER (WHERE due_at IS NOT NULL) INTO n_all, n_due FROM tickets;
    sum_all := sum_all + n_all; sum_due := sum_due + n_due;
    IF n_all > 0 THEN
      RAISE NOTICE '  % : 卡片 % 張 · 有 due_at % 張', rpad(t.name, 22), n_all, n_due;
    END IF;
  END LOOP;
  RAISE NOTICE '  ── 合計：卡片 % 張 · 有 due_at % 張', sum_all, sum_due;

  -- ⚠️ 自我檢查：抓不到之後還繼續跑，比抓不到更糟。
  IF sum_all = 0 THEN
    RAISE EXCEPTION '合計 0 張卡片 —— 這是「沒看到資料」不是「沒有資料」。'
      ' set_config 沒生效或連錯庫，不要把 0 當結論。';
  END IF;
  IF sum_due > 0 THEN
    RAISE WARNING 'due_at 已經有 % 張有值 —— 我原本的前提（100%% null）是錯的，'
      '上線影響要重算', sum_due;
  END IF;
END $$;

\echo ''
\echo '═════════ ② 分母：最近的對話裡有沒有東西可抽 ═════════'
\echo '（analysis_result 沒有 RLS，所以這段看得到全部租戶。）'
\echo '⚠️ 這個粗篩會多抓 ——「8/24 已完成」也含日期。它回答的是「有沒有東西可抽」，'
\echo '   不是「該抽到幾筆」。低不代表抽取不好，但為 0 就代表整個功能沒意義。'

WITH msg AS (
  SELECT au.tenant_slug,
         au.batch_date,
         m->>'text' AS text
  FROM analysis_result ar
  JOIN analysis_upload au ON au.id = ar.upload_id
  CROSS JOIN LATERAL jsonb_array_elements(ar.messages) AS m
  WHERE ar.messages IS NOT NULL
    AND m->>'kind' = 'text'
    AND au.batch_date >= current_date - 30
)
SELECT coalesce(tenant_slug, '(無)') AS 租戶,
       count(*) AS 近30天訊息數,
       count(*) FILTER (
         WHERE text ~ '(\d{1,2})\s*[/月]\s*(\d{1,2})|下週|下星期|下禮拜|本週|這週|明天|後天|月底|月初|下個?月|週[一二三四五六日天]|星期[一二三四五六日天]'
       ) AS 看起來在講日期,
       round(100.0 * count(*) FILTER (
         WHERE text ~ '(\d{1,2})\s*[/月]\s*(\d{1,2})|下週|下星期|下禮拜|本週|這週|明天|後天|月底|月初|下個?月|週[一二三四五六日天]|星期[一二三四五六日天]'
       ) / nullif(count(*), 0), 1) AS 佔比百分比
FROM msg
GROUP BY 1
ORDER BY 2 DESC;

-- ⚠️ 上面那張表回 0 列時，psql 只會印一張空表就過去了 ——
--    而「一列都沒有」有兩種完全不同的意思：真的沒有近 30 天的分析，
--    或是 join／欄位條件寫錯（例如 kind 不叫 'text'）。分不出來就不能下結論。
DO $$
DECLARE n_res bigint; n_msg bigint; n_recent bigint;
BEGIN
  SELECT count(*) INTO n_res FROM analysis_result;
  SELECT count(*) INTO n_msg FROM analysis_result WHERE messages IS NOT NULL;
  SELECT count(*) INTO n_recent
    FROM analysis_result ar JOIN analysis_upload au ON au.id = ar.upload_id
   WHERE ar.messages IS NOT NULL AND au.batch_date >= current_date - 30;
  RAISE NOTICE '  對照：analysis_result 共 % 筆 · 有 messages % 筆 · 近 30 天 % 筆', n_res, n_msg, n_recent;
  IF n_recent = 0 THEN
    RAISE WARNING '近 30 天沒有任何分析結果 —— 上面的空表是「沒東西可看」，'
      '不是「沒有人在講日期」。放寬天數再跑，不要拿它當 gate 結論。';
  ELSIF n_msg > 0 THEN
    -- kind 的值若不是 'text'，上面的 FILTER 會全數落空而不報錯
    PERFORM 1 FROM analysis_result ar
      CROSS JOIN LATERAL jsonb_array_elements(ar.messages) m
     WHERE m->>'kind' = 'text' LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION '有 messages 但沒有任何 kind=''text'' 的元素 —— '
        '欄位條件寫錯了，上面的數字全部無效。';
    END IF;
  END IF;
END $$;

\echo ''
\echo '═════════ ③ 逾時基準線：現在有幾張逾時卡 ═════════'
\echo '（上線後要拿這組數字對照。現在全部走「建立日 + 寬限天數」那條，'
\echo ' 因為 due_at 全是 null；之後有 due_at 的卡會改走 due_at 那條、少掉寬限。）'

-- 寬限天數是各租戶自己設的（沒設就吃預設 7 天 · DEFAULT_TASK_CONFIG）
SELECT coalesce(t.tenant_name, t.tenant_id::text) AS 租戶,
       tc.overdue_grace_days AS 寬限天數, tc.reminder_tier_days AS 提醒級距
FROM tenants t LEFT JOIN tenant_task_config tc ON tc.tenant_id = t.tenant_id
ORDER BY 1;

DO $$
DECLARE
  t RECORD; grace int; n_overdue bigint; n_open bigint; sum_overdue bigint := 0;
BEGIN
  FOR t IN SELECT tenant_id, coalesce(tenant_name, tenant_id::text) AS name FROM tenants ORDER BY 2 LOOP
    PERFORM set_config('app.current_tenant', t.tenant_id::text, true);
    SELECT coalesce(max(overdue_grace_days), 7) INTO grace FROM tenant_task_config WHERE tenant_id = t.tenant_id;
    -- ⚠️ confirm_status 的值是**中文**（待簽核／已簽核／逾時警示／待確認／已忽略／存查）。
    --    第一版我寫 'pending' —— 不會報錯，只會安靜地全部回 0。
    -- ⚠️ 逾時的定義照抄 task-config.service.ts:113 的原文，不自己重寫一份。
    SELECT count(*) FILTER (WHERE confirm_status = '待簽核'),
           count(*) FILTER (
             WHERE confirm_status = '待簽核'
               AND ( (due_at IS NOT NULL AND due_at < now())
                  OR (due_at IS NULL AND created_at < now() - make_interval(days => grace)) ))
      INTO n_open, n_overdue FROM tickets;
    IF n_open > 0 THEN
      RAISE NOTICE '  % : 待簽核 % 張 · 其中逾時 % 張（寬限 % 天）',
        rpad(t.name, 22), n_open, n_overdue, grace;
    END IF;
    sum_overdue := sum_overdue + n_overdue;
  END LOOP;
  RAISE NOTICE '  ── 逾時合計：% 張（這是「上線前」的數字，記下來）', sum_overdue;
END $$;

\echo ''
\echo '═════════ 判讀 ═════════'
\echo '① due_at 合計不是 0 → 我的前提錯了，回報我。'
\echo '② 「看起來在講日期」為 0 → 整個行事曆功能沒有素材，不要做 M4，回報我。'
\echo '   有數字 → 拿它當 gate 的分母，再跑 gate-due-at-rate.ts 看實際抽到幾筆。'
\echo '③ 逾時合計 → 記下來。上線一週後再跑一次這段，數字應該只會慢慢長，'
\echo '   不該一次跳很多；跳很多代表 due_at 被填上了過去的日期（抽取有問題）。'
\echo ''
