-- 0057_analysis_service_intake.sql — analysis_result 加第二 L2 區塊：客服報修派工單
-- 對照 docs/modules/extraction-schema-service-intake.md（M1 v2）
-- 冪等：可重跑（IF NOT EXISTS）· prod 已於 2026-08-01 手動套過，此檔為 repo 一致性
--
-- 背景：service_order 模板除了 service_reports（進度回報），另用**獨立第二次 LLM 呼叫**
-- 抽「報修派工單」（含「是否保固內」）到 service_intake。warranty 只存在報修單裡，
-- 是 service_reports warranty 填出率 0% 的真因。
--
-- ⚠️ additive · default '[]'＝既有 row 零變化。analysis_result 無 RLS，
--    讀 service_intake 的使用者可見端點必須 service 層明確 filter tenant/dept（doc FMEA F-4）。

BEGIN;

ALTER TABLE analysis_result
  ADD COLUMN IF NOT EXISTS service_intake jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN analysis_result.service_intake IS
  '客服報修派工單（service_order 第二區塊 · 獨立 LLM 呼叫）· customer/vehicle/warranty/issue/status · phone 遮罩尾三碼（ESI-2）· 空陣列＝該批無報修單或非 service_order 模板';

COMMIT;
