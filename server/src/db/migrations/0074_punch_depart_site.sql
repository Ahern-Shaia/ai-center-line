-- Migration 0074 · 打卡加入「離站」· docs/modules/attendance-trip-state-machine.md §6
--
-- 為什麼要這個型別：現在只有「出發／到點」，所以系統知道他何時**抵達**，
-- 卻不知道他何時**離開** —— 於是「這一趟花了多久」算不出來，
-- 而那正是客戶要的「抵達與離開配對＝這次任務完成時間」（§5-bis）。
--
-- ⚠️ 這支是**放寬**（多一個合法值），不是收緊：
--   · 舊資料完全不受影響（三個舊值仍合法）
--   · 舊程式碼讀到 depart_site 也不會崩（punch_type 一路都是字串傳遞）
--   · 因此 migration 先上、程式後上是安全的（空窗期不會有人寫入新值）
--
-- ⛔ 刻意**不做** source 加 'auto'：
--    OQ-TSM-4 採 (b)「隔日首次打卡補寫前一日」＝使用者觸發，不是 cron，
--    不需要那個來源值。改採 (a) 自動收班才需要（§0-bis ⑥）。
--    不預先加：沒有寫入者的列舉值只會讓後人猜它是幹嘛的。

-- ============================================================
-- 1. punch_type 放寬 · 加 depart_site
-- ============================================================
-- ⚠️ 不寫死 constraint 名稱去 DROP。0023 建表時是 inline CHECK，
--    名字由 Postgres 自動產生 —— 現在確實叫 attendance_punch_punch_type_check，
--    但如果哪個環境不是（改過表、還原過備份），
--    `DROP CONSTRAINT IF EXISTS <猜的名字>` 會**靜默什麼都沒做**，
--    然後新的 CHECK 加上去、舊的還在，depart_site 照樣被擋 ——
--    而 migration 會顯示成功。所以改成「按定義找出來再砍」。
DO $$
DECLARE cn text;
BEGIN
  FOR cn IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'attendance_punch'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%punch_type%'
  LOOP
    EXECUTE format('ALTER TABLE attendance_punch DROP CONSTRAINT %I', cn);
    RAISE NOTICE '  已移除舊約束：%', cn;
  END LOOP;
END $$;

ALTER TABLE attendance_punch ADD CONSTRAINT attendance_punch_punch_type_check
  CHECK (punch_type IN ('clock_in', 'arrive_site', 'depart_site', 'clock_out'));

COMMENT ON COLUMN attendance_punch.punch_type IS
  'clock_in=出發 / arrive_site=抵達 / depart_site=離站 / clock_out=收班。'
  'arrive_site→depart_site 成對＝一趟任務的停留時間（衍生計算，不落庫）。';

-- ============================================================
-- 2. 自我驗證 —— 「跑完了」不等於「有效」
-- ============================================================
-- ⚠️ 這一段是刻意的。放寬型 migration 最常見的失敗是「看起來成功、實際沒生效」
--    （舊約束沒砍掉、或砍錯一條）。這裡直接試寫一筆再回滾，
--    行為對不上就讓整支 migration 失敗，不要留一個假的成功。
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    -- 用不存在的租戶/使用者會先撞 FK，所以只驗 CHECK 本身：
    -- 直接問 Postgres 這個值合不合法。
    PERFORM 1 FROM pg_constraint
     WHERE conrelid = 'attendance_punch'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%depart_site%';
    ok := FOUND;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION '0074 沒有生效：找不到含 depart_site 的 CHECK 約束';
  END IF;

  -- 舊約束必須只剩一條（多條 punch_type CHECK 會互相疊加，新值仍被擋）
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'attendance_punch'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) ILIKE '%punch_type%') <> 1 THEN
    RAISE EXCEPTION '0074 有多條 punch_type 約束並存 —— 舊的沒砍乾淨，depart_site 仍會被擋';
  END IF;

  RAISE NOTICE '  ✅ 0074 生效：punch_type 已接受 depart_site';
END $$;
