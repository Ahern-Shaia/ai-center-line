-- 0057_analysis_service_intake.sql — analysis_result 加第二 L2 區塊：客服報修派工單
-- 對照 docs/modules/extraction-schema-service-intake.md（M1）
-- 冪等：可重跑
--
-- 背景：service_order 模板原本只吐 service_reports（師傅的今日進度回報）。
-- 客服貼的「報修派工單」（含「是否保固內」）是不同 lifecycle，另立 service_intake 區塊，
-- 不混進 service_reports。這也是 warranty 填出率 0% 的真因（帶 warranty 的報修單整型別沒被抽）。
--
-- ⚠️ additive · default '[]'＝既有 row 零變化（compat）。analysis_result 無 RLS，
--    讀 service_intake 的使用者可見端點必須 service 層明確 filter tenant/dept（見 doc FMEA F-4）。

BEGIN;

ALTER TABLE analysis_result
  ADD COLUMN IF NOT EXISTS service_intake jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN analysis_result.service_intake IS
  '客服報修派工單（service_order 模板第二區塊）· customer/vehicle/warranty/issue/status · phone 已遮罩尾三碼（ESI-2）· 空陣列＝該批無報修單或非 service_order 模板';

COMMIT;
