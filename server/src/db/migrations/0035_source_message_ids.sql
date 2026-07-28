-- Migration 0035 · 補「任務 → 原始 LINE 訊息」的鏈
-- 依 docs/modules/task-completion-tracking.md §1.6 D / M1
--
-- 背景（prod 實測 2026-07-28）：
--   tickets.source_message_ids 是 0 / 35 有值 —— 從來沒被寫過。
--   實際的回溯路徑是
--     ticket → source_upload_id + source_record_index
--     → analysis_result.records[i].source_ids = [0,1,2]   ← 是「陣列索引」
--     → analysis_result.messages[j]                        ← 沒有 LINE 訊息 id、發話者還被假名化
--   所以目前**無法從任務回推到某一則 line_message**，R11 的可溯源只活在條文裡。
--
-- 這條鏈斷著，LINE 引用回覆就找不到要關哪一張任務（doc F-17），
-- 而引用回覆是本案的主要入口。所以先補鏈。
--
-- ⚠️ 型別要改：line_message.message_id 是 LINE 給的字串（例 "623859740295823770"），
--    不是 uuid。原本宣告成 uuid[] 就是這欄從沒被寫過的原因之一。
--    因為現存資料全是 NULL，直接轉型不會掉資料 —— 但還是先擋一道，
--    萬一在別的環境有資料，寧可 migration 失敗也不要靜靜丟掉。

-- ============================================================
-- 1 · analysis_upload：記下這批 blob 每一行對應的 LINE 訊息 id
--
-- 為什麼存在 upload 而不是每則訊息各存一份：
-- pipeline 收到的是「拼好的匯出檔字串」，parser 重新編號 0,1,2...
-- 那個編號就是 records[].source_ids 的內容。要把索引翻回真實 id，
-- 需要的正是「這批 blob 的第 N 行是哪一則」這份對照表。
-- ============================================================
ALTER TABLE analysis_upload
  ADD COLUMN IF NOT EXISTS source_message_ids text[];

COMMENT ON COLUMN analysis_upload.source_message_ids IS
  '這批 blob 逐行對應的 line_message.message_id（順序即 parser 的編號）· NULL = 手動上傳的匯出檔，沒有對應來源';

-- ============================================================
-- 2 · tickets.source_message_ids：uuid[] → text[]
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tickets
    WHERE source_message_ids IS NOT NULL
      AND array_length(source_message_ids, 1) > 0
  ) THEN
    RAISE EXCEPTION
      'tickets.source_message_ids 有資料，不可直接轉型 —— 請先確認遷移方式（本 migration 假設此欄從未被寫過）';
  END IF;
END $$;

ALTER TABLE tickets
  ALTER COLUMN source_message_ids TYPE text[] USING NULL;

COMMENT ON COLUMN tickets.source_message_ids IS
  '這張任務出自哪幾則 line_message（R11 可溯源）· 由 materializer 經 analysis_upload.source_message_ids 把 records[].source_ids 的索引翻譯而來';

-- 引用回覆要用 quotedMessageId 反查任務 · 這是 M3 的熱路徑
CREATE INDEX IF NOT EXISTS ix_tickets_source_messages
  ON tickets USING gin (source_message_ids);
