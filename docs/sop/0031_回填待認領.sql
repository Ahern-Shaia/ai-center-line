-- 0031 回填補跑 · 把「有人名但還沒歸屬」的既有任務標成待認領
--
-- ⚠️ 為什麼要補跑：
-- migration 0031 結尾那句 UPDATE 被 tickets 的 RLS 擋掉了，靜默更新 0 筆。
-- tickets 的 policy 是 AND 條件、**沒有 actor_role 逃生門**：
--     tenant_id = app.current_tenant AND (actor_role <> 'group_owner' OR department 相符)
-- psql 直連沒設 app.current_tenant → 條件不成立 → UPDATE 0 筆且**不報錯**。
-- （本專案第 4 次踩這個坑，見 docs/sop/清理測試群分析結果.sql STEP 0）
--
-- 影響：不補跑的話，既有 12 張任務全部停在「未指派」，
-- 主管進看板看不到「待認領」，不知道有哪些需要他手動派。
-- 新產生的任務不受影響（走程式碼路徑，會正確標記）。
--
-- 依 R10：本檔只產生指令，由人手動在 prod 執行。

-- ============================================================
-- STEP 1 · 開 RLS 上下文（沒這段下面全部會是 0 筆）
-- ============================================================
SET app.actor_role = 'aiproot_admin';
SET app.current_tenant = '4d97eced-64c5-4a38-952b-dfce9588ab7c';   -- 台灣福祉

-- ============================================================
-- STEP 2 · 先看會影響哪幾筆（不改任何東西）
-- ============================================================
SELECT ticket_id, assignee_display_name AS AI讀到的人名, assign_status, left(summary, 40) AS 摘要
FROM tickets
WHERE assign_status = 'none'
  AND nullif(assignee_display_name, '') IS NOT NULL
ORDER BY created_at DESC;

-- ============================================================
-- STEP 3 · 回填
-- 只動「AI 有讀到人名、但還沒任何歸屬」的 → 標成待認領，等主管派。
-- 不去猜對象（猜錯＝把甲的工作寫進乙的日報）。
-- ============================================================
UPDATE tickets
   SET assign_status = 'unclaimed'
 WHERE assign_status = 'none'
   AND nullif(assignee_display_name, '') IS NOT NULL;

-- ============================================================
-- STEP 4 · 驗證：應看到 unclaimed 有筆數，且 none 只剩「AI 沒讀到人名」的
-- ============================================================
SELECT assign_status,
       count(*) AS 筆數,
       count(*) FILTER (WHERE nullif(assignee_display_name, '') IS NOT NULL) AS 其中有人名
FROM tickets
GROUP BY 1 ORDER BY 1;
-- 預期：unclaimed 筆數 = 其中有人名；none 的「其中有人名」應為 0
