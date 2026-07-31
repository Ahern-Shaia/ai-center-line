-- Rollback 0056 · 無法還原成原本的隨機 UUID（也不該還原 —— 那是壞的）。
-- 這是資料修正，正確狀態就是 permission_id = 'resource:action'。留此檔為 no-op。
SELECT 1;
