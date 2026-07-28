-- 0033 回填 · 把既有任務補上 status 並把公告／已完成的移出簽核佇列
-- 依 docs/modules/task-materialization-gate.md
--
-- ⚠️ 為什麼要補跑而不是寫在 migration 裡：
-- tickets 的 RLS policy 是 AND 條件、**沒有 actor_role 逃生門**：
--     tenant_id = app.current_tenant AND (actor_role <> 'group_owner' OR department 相符)
-- psql 直連沒設 app.current_tenant → 條件不成立 → UPDATE 0 筆且**不報錯**。
-- （本專案第 5 次踩這個坑，0031 就是這樣靜默失敗的）
--
-- 背景：materializer 從來沒寫過 tickets.status（prod 15 張全是 null），
-- 所以既有的票分不出「待辦」還是「公告」。新產生的票不受影響（走程式碼路徑會正確標記）。
--
-- 影響：不補跑的話，那 6 張公告與已完成的事會繼續掛在「待簽核」等主管處理。
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
SELECT t.ticket_id,
       e.r ->> 'status'  AS 來源狀態,
       t.confirm_status  AS 目前佇列,
       CASE WHEN e.r ->> 'status' IN ('open','in_progress') THEN '留在待簽核'
            ELSE '移到存查' END AS 將變成,
       left(t.summary, 34) AS 摘要
FROM tickets t
JOIN analysis_result ar ON ar.upload_id = t.source_upload_id
CROSS JOIN LATERAL jsonb_array_elements(ar.records) WITH ORDINALITY AS e(r, ord)
WHERE e.ord - 1 = t.source_record_index
  AND t.status IS NULL
ORDER BY 4, 1;

-- ============================================================
-- STEP 3 · 回填 status（把當初被丟掉的狀態補回來）
-- ============================================================
UPDATE tickets t
   SET status = e.r ->> 'status',
       updated_at = now()
  FROM analysis_result ar
  CROSS JOIN LATERAL jsonb_array_elements(ar.records) WITH ORDINALITY AS e(r, ord)
 WHERE ar.upload_id = t.source_upload_id
   AND e.ord - 1 = t.source_record_index
   AND t.status IS NULL;

-- ============================================================
-- STEP 4 · 把公告與已完成的移出簽核佇列
-- 只動「還沒有人簽過」的（confirm_status = '待簽核'）——
-- 已經簽核的是人的決定，不回頭改。
-- ============================================================
UPDATE tickets
   SET confirm_status = '存查',
       updated_at = now()
 WHERE confirm_status = '待簽核'
   AND status IS NOT NULL
   AND status NOT IN ('open', 'in_progress');

-- ============================================================
-- STEP 5 · 驗證
-- ============================================================
SELECT confirm_status AS 佇列, status AS 來源狀態, count(*) AS 筆數
FROM tickets
GROUP BY 1, 2
ORDER BY 1, 2;
-- 預期（依 2026-07-27 快照）：
--   待簽核 · open 4 + in_progress 5 = 9 張
--   存查   · info 4 + resolved 2   = 6 張
--   status 為 null 的應為 0 張

SELECT count(*) AS 仍未補到狀態的
FROM tickets WHERE status IS NULL;
-- 若不為 0：代表那幾張的來源 analysis_result 已被刪除（例如清過測試群），
-- 它們會留在待簽核。可個別檢視後手動處理，不要盲目改成存查。
