-- Migration 0032 · 素材看板檔案刪除（誤傳處理）
-- 依 docs/modules/media-and-vision.md §7
--
-- 兩段式刪除（用戶 2026-07-28 裁定）：
--   ① 一般刪除 = 隱藏，保留 30 天可還原（拉錯救得回來）
--   ② 到期自動清除 or 我方平台端立即徹底刪除 → R2 物件真的抹掉
--
-- 為什麼不直接 DELETE 這一列：
--   刪掉就沒人知道「這裡曾經有一個檔案、被誰在什麼時候刪掉」。
--   誤傳常是個資（車牌／證件／病歷），事後被問「那張照片呢」要答得出來。
--   line_message 那一列也一定要留 —— 原始訊息不可變（CLAUDE.md R11）。
--
-- 狀態機（三態，靠兩個時間欄位表達）：
--   deleted_at IS NULL                      → 正常，看板列得出來
--   deleted_at 有值 + purged_at IS NULL     → 已刪除，檔案還在 R2，可還原
--   purged_at 有值                          → 已徹底清除，storage_key 抹成 NULL

ALTER TABLE line_media
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS purged_at timestamptz;

-- 看板每次查詢都要濾掉已刪除的 · 走部分索引，正常檔案的查詢不會被已刪除的拖慢
CREATE INDEX IF NOT EXISTS ix_line_media_active
  ON line_media (tenant_id, downloaded_at DESC)
  WHERE deleted_at IS NULL;

-- 清除排程只掃「已刪除但還沒清掉」的，通常是很小的一撮
CREATE INDEX IF NOT EXISTS ix_line_media_pending_purge
  ON line_media (deleted_at)
  WHERE deleted_at IS NOT NULL AND purged_at IS NULL;

COMMENT ON COLUMN line_media.deleted_at IS '軟刪除時間 · 30 天後由排程清除 R2 物件';
COMMENT ON COLUMN line_media.purged_at  IS 'R2 物件實際被抹掉的時間 · 有值代表不可還原';
