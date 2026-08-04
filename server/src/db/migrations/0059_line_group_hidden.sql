-- 0059_line_group_hidden.sql — line_group.status 加 'hidden'（客戶可移除已離開的群）
-- 冪等：可重跑
--
-- 背景：bot 離開群後該列變 status='left'，永遠留在「已離開的群」清單裡。
-- 客戶回饋「留著也沒意義」，但**不能真刪**：
--   analysis_upload / line_message 是用 group_id 關聯（非外鍵指向 line_group），
--   刪了 row，歷史群組日誌的群名會從「福祉LIFF」變成「未命名 · c4d7ca8」。
--   測試群無所謂，真客戶結束案場群、幾個月歷史還在時就很有感。
--
-- 所以做成隱藏：清單乾淨、歷史留名。
-- ⚠️ bot 若重新被加入該群，webhook upsert 收到 join 事件會把 status 設回 'active'
--    （line-group.repository upsertOnEvent 的 CASE），所以隱藏不是死路，會自動復活。

BEGIN;

ALTER TABLE line_group DROP CONSTRAINT IF EXISTS line_group_status_check;
ALTER TABLE line_group
  ADD CONSTRAINT line_group_status_check
  CHECK (status IN ('active', 'left', 'hidden'));

COMMENT ON COLUMN line_group.status IS
  'active=bot 在群內 / left=bot 已離開 / hidden=已離開且被客戶移出清單（歷史資料仍保留群名；bot 重新加入會自動回到 active）';

COMMIT;
