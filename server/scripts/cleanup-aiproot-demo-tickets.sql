-- cleanup-aiproot-demo-tickets.sql — 清掉 aiproot 租戶的 6 張 demo 種子任務
--
-- 租戶：77777777-0000-0000-0000-000000000001（aiproot）
--
-- 這 6 張是 2026-07-02~03 的 demo 種子資料，特徵：
--   · source_upload_id 全為 NULL（來源分析批次早就被刪了，是孤兒）
--   · category 還是舊制中文名（研發技術KM / 採購訂單 / 維修工單），
--     而 aiproot 的 category_registry 是 0 筆 —— 對不上現行分類體系
--   · 其中 4 張的 confirmed_by 指向宗瀚 / 建國，外鍵是 NO ACTION，
--     所以**不先刪任務就刪不掉那兩個使用者**
--
-- 順序：先跑這支 → 再到後台刪 宗瀚 / 建國 / 阿豪
--       （使用者走後台是為了留 audit log；直接 SQL 會繞過稽核）
--
-- ⚠️ 不能用 scripts/prod-query.sh（唯讀）。用 psql 直接跑這個檔。
--
-- RLS：tickets 的 policy 是 AND-only、**沒有 aiproot_admin 逃生門**：
--        tenant_id = app.current_tenant AND (app.current_department IS NULL OR 相符)
--      current_tenant 沒設對就影響 0 列且不報錯；current_department 沒清空
--      就只會刪到該部門的，其餘靜靜留著。

BEGIN;

SET LOCAL app.current_tenant     = '77777777-0000-0000-0000-000000000001';
SET LOCAL app.current_department = '';          -- 留空 = 不限部門
SET LOCAL app.actor_role         = 'system';

-- 守衛：只有在「全部都是孤兒 demo 任務」時才動手。
-- 若之後 aiproot 開始有真實任務進來（有 source_upload_id），這支就會中止，
-- 不會把真資料一起掃掉。
DO $$
DECLARE n_total int; n_orphan int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE source_upload_id IS NULL)
    INTO n_total, n_orphan
  FROM tickets WHERE tenant_id = '77777777-0000-0000-0000-000000000001'::uuid;

  IF n_total <> 6 THEN
    RAISE EXCEPTION '守衛失敗：預期 6 張任務，實得 % 張 —— 資料已變動，請重新確認再跑', n_total;
  END IF;
  IF n_orphan <> n_total THEN
    RAISE EXCEPTION '守衛失敗：有 % 張任務仍掛著分析批次（非 demo 孤兒），中止', n_total - n_orphan;
  END IF;
END $$;

-- pending_completion_signal.resolved_ticket_id 是 ON DELETE SET NULL，
-- 且 aiproot 目前 0 筆，不需另外處理。
DELETE FROM tickets WHERE tenant_id = '77777777-0000-0000-0000-000000000001'::uuid;

-- 驗收 1：aiproot 任務歸零
SELECT count(*) AS 剩餘任務 FROM tickets WHERE tenant_id = '77777777-0000-0000-0000-000000000001'::uuid;

-- 驗收 2：三個 demo 使用者已無任何任務引用（接下來才刪得掉）
SELECT u.display_name AS 使用者,
       (SELECT count(*) FROM tickets t WHERE t.confirmed_by = u.user_id) AS 仍被簽核引用,
       (SELECT count(*) FROM tickets t WHERE t.assigned_by  = u.user_id) AS 仍被指派引用
FROM users u
WHERE u.tenant_id = '77777777-0000-0000-0000-000000000001'::uuid
  AND u.email IN ('rd-zonghan@taiwanhomecare.demo','sales-jianguo@taiwanhomecare.demo','owner-d2@taiwanhomecare.demo');

-- 驗收 3：台灣福祉的任務數不可變（確認沒有跨租戶誤刪）· 應為 141
SELECT count(*) AS 台灣福祉任務數 FROM tickets WHERE tenant_id = '4d97eced-64c5-4a38-952b-dfce9588ab7c'::uuid;

-- 數字對了就把這行改成 COMMIT
ROLLBACK;
