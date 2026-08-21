-- 0068_line_group_type.sql — LINE 群組加「類型」：哪些群定義組織，哪些不定義
-- 冪等：可重跑
--
-- 對應 docs/modules/group-type-classification.md v0.4
-- （doc 裡寫的編號是 0066，實際落地時 0066/0067 已被佔用，改 0068）
--
-- 背景：台灣福祉 66% 的員工「跨部門」，但那不是他們的組織形狀 ——
-- 是我們把每一個 LINE 群都當成一個部門，而其中混著：
--   · 全員群「有你真好」40 人 ＝ 全體 56 人的 71%（第二名的兩倍多）
--   · 跨部門作業群「報工及車輛調度」19 人（各部門技師都在那裡報工排車）
--   · 測試群、甚至跟 bot 的一對一聊天
-- 全員群一旦被當成部門，每個在裡面的人都自動「跨」了一個部門。
--
-- ⚠️ **`department_id` 一律保留，不清成 NULL。**
--    tickets.department_id 是 NOT NULL（0001:57），而流程群正是產出最多任務的地方。
--    清掉關聯 → 材料化建卡失敗 → 那些任務整批消失。
--    所以類型只影響「顯示與統計」，不影響「資料歸屬」。

BEGIN;

ALTER TABLE line_group
  ADD COLUMN IF NOT EXISTS group_type text NOT NULL DEFAULT 'department'
    CHECK (group_type IN ('department', 'process', 'announcement', 'test'));

COMMENT ON COLUMN line_group.group_type IS
  'department=這群人就是那個部門（唯一會定義組織歸屬的類型）· process=跨部門作業群 · announcement=全員/公告群 · test=測試或一對一，不屬於組織。預設 department → 不回填就與 0068 之前完全同行為';

-- 只有 department 型的群會被組織圖與部門推導使用，那兩處都會帶這個條件
CREATE INDEX IF NOT EXISTS ix_line_group_type ON line_group (bot_id, group_type)
  WHERE status = 'active';

COMMIT;

-- ── 回填由人判斷，不自動猜（OQ-GTC-3）──
--
-- ⚠️ 不要用「人數 ÷ 全體 > 60%」之類的規則自動套。猜錯會讓一個真部門
--    從組織圖上消失，而使用者只會看到「我的部門不見了」，不會聯想到是分類。
--    可以拿人數當提示，但要人按下去。
--
-- 台灣福祉的候選（等 C1–C3 客戶確認後再執行）：
--
--   SET app.actor_role = 'aiproot_admin';
--   UPDATE line_group SET group_type = 'announcement' WHERE display_name = '有你真好';
--   UPDATE line_group SET group_type = 'process'      WHERE display_name = '報工及車輛調度';
--   UPDATE line_group SET group_type = 'test'
--    WHERE display_name ILIKE '%測試%' OR display_name ILIKE '%LIFF%'
--       OR display_name LIKE '%, 柏淵';     -- 跟 bot 的一對一聊天
--
-- 套完檢查：
--   SELECT group_type, count(*), string_agg(display_name, '、') FROM line_group
--    WHERE status='active' GROUP BY 1 ORDER BY 2 DESC;
