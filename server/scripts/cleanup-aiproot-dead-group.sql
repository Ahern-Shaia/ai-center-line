-- cleanup-aiproot-dead-group.sql — 清掉 aiproot 租戶那個沒用到的暫時群
--
-- 群組：Cbc84f7a46975988b41ffdcad370f094d（未命名 · bot 已離開）
-- Bot ：99142261-c99d-4aac-9256-67158382c700（aiproot）
-- 租戶：77777777-0000-0000-0000-000000000001（aiproot）
--
-- 由來：2026-08-04 把 aiproot bot 拉進測試群的過程中，先進錯了一個群，
--       隨即退出。留下 1 則訊息、1 個成員、1 列 line_group（status='left'）。
--       0 個分析批次、0 張任務 —— 沒有任何東西依賴它。
--
-- 為什麼不能用後台的「移除」按鈕：那個只把 status 改成 'hidden'（0059），
--   清單看不到但資料還在。這裡要的是真的刪掉。
--
-- ⚠️ 不能用 scripts/prod-query.sh（唯讀）。用 psql 直接跑這個檔。
--
-- RLS：line_message / line_member / line_group 三張表的 policy 都有
--      actor_role in (aiproot_admin, consultant, system) 的逃生門，
--      設 'system' 即可；current_tenant 一併設好當第二道保險。
--      少設的話 DELETE 會影響 0 列而且**不報錯**。

BEGIN;

SET LOCAL app.actor_role     = 'system';
SET LOCAL app.current_tenant = '77777777-0000-0000-0000-000000000001';

-- 守衛：確認這個群真的是「aiproot 的、已離開的、沒有分析資料的」那一個。
-- 條件不符就中止 —— 避免手滑刪到現役的測試群 C0179efb。
DO $$
DECLARE n_group int; n_ticket int;
BEGIN
  SELECT count(*) INTO n_group FROM line_group
  WHERE group_id = 'Cbc84f7a46975988b41ffdcad370f094d'
    AND bot_id   = '99142261-c99d-4aac-9256-67158382c700'
    AND status   = 'left';
  IF n_group <> 1 THEN
    RAISE EXCEPTION '守衛失敗：預期 1 列 left 狀態的群，實得 % 列', n_group;
  END IF;

  -- 2026-08-04 19:16 的批次把這個死群也掃了一次（1 則訊息、0 張任務）。
  -- 所以守衛從「不可以有批次」放寬成「不可以有任務」——
  -- 有任務代表它產出過內容，那就不是純死資料，要停下來人工確認。
  SELECT count(*) INTO n_ticket FROM tickets t
  JOIN analysis_upload a ON a.id = t.source_upload_id
  WHERE a.group_id = 'Cbc84f7a46975988b41ffdcad370f094d';
  IF n_ticket <> 0 THEN
    RAISE EXCEPTION '守衛失敗：這個群產出過 % 張任務，不是預期的死資料，請先確認', n_ticket;
  END IF;
END $$;

-- 批次先刪（analysis_batch.upload_id 是 ON DELETE SET NULL，先刪 upload 會留下孤兒列）
DELETE FROM analysis_batch WHERE upload_id IN (
  SELECT id FROM analysis_upload WHERE group_id = 'Cbc84f7a46975988b41ffdcad370f094d'
                                   AND tenant_id = '77777777-0000-0000-0000-000000000001'::uuid);
DELETE FROM analysis_upload WHERE group_id = 'Cbc84f7a46975988b41ffdcad370f094d'   -- 連帶 result / label
                              AND tenant_id = '77777777-0000-0000-0000-000000000001'::uuid;
DELETE FROM line_message WHERE group_id = 'Cbc84f7a46975988b41ffdcad370f094d'   -- 連帶 line_media
                           AND bot_id   = '99142261-c99d-4aac-9256-67158382c700';
DELETE FROM line_member  WHERE group_id = 'Cbc84f7a46975988b41ffdcad370f094d'
                           AND bot_id   = '99142261-c99d-4aac-9256-67158382c700';
DELETE FROM line_group   WHERE group_id = 'Cbc84f7a46975988b41ffdcad370f094d'
                           AND bot_id   = '99142261-c99d-4aac-9256-67158382c700';

-- 驗收 1：上面那個群三張表都要是 0
SELECT 'line_message' AS 表, count(*) AS 殘留 FROM line_message WHERE group_id = 'Cbc84f7a46975988b41ffdcad370f094d'
UNION ALL SELECT 'line_member', count(*) FROM line_member WHERE group_id = 'Cbc84f7a46975988b41ffdcad370f094d'
UNION ALL SELECT 'line_group',  count(*) FROM line_group  WHERE group_id = 'Cbc84f7a46975988b41ffdcad370f094d';

-- 驗收 2：現役測試群必須完好（1 列 active · 6 則訊息 · 3 名成員）
SELECT g.display_name AS 群名, g.status,
       (SELECT count(*) FROM line_message m WHERE m.group_id = g.group_id AND m.bot_id = g.bot_id) AS 訊息,
       (SELECT count(*) FROM line_member  n WHERE n.group_id = g.group_id AND n.bot_id = g.bot_id) AS 成員
FROM line_group g WHERE g.group_id = 'C0179efb56e6ea107ebe9169e047e3d3e';

-- 數字對了就把這行改成 COMMIT
ROLLBACK;
