-- 0073 · 打卡當下寫一句「這趟做了什麼」· docs/modules/punch-note-to-report.md
--
-- 為什麼要這欄：日報 16 份只有 3 份送出（19%），最可能的原因是「要自己想今天做了什麼」。
-- 「今天打卡去過 N 個地方 → 加入日報」早就有了，但帶進去的 detail 是空字串 ——
-- 這欄就是要填那一格。
--
-- ⚠️ 可為 null 且**不給 DEFAULT ''**：null ＝「沒寫」、'' ＝「寫了空的」，
--    兩者在畫面上要長得不一樣（沒寫的顯示提示、寫了空的不顯示）。
-- ⚠️ 純加可空欄位 → migration 與 push 之間的空窗期行為不變（既有程式不讀這欄）。
ALTER TABLE attendance_punch ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN attendance_punch.note IS
  '打卡當下寫的「這趟做了什麼」· 可為 null（刻意不強制，打卡不可被日報綁架）· 事後可改（同 customer_name）';
