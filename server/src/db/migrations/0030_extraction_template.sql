-- 0030_extraction_template.sql — 抽取模板（ai-analysis-layering L2）
-- 對照 docs/modules/ai-analysis-layering.md（v1.0 APPROVED · OQ-AAL-5/6）
-- 冪等：可重跑
--
-- 背景：抽取 schema 分三層 —— L1 通用核心（所有租戶共用、不可關）、
-- L2 業種模板（每租戶選一個）、L3 租戶詞彙（資料，不在此）。
-- 本欄位存 L2 的選擇。
--
-- ⚠️ default 刻意設為 'factory_report' ＝ 現行行為，既有租戶零變化（compat）。
-- 要改成 general / service_order 由人在後台操作，不在 migration 裡動客戶資料。

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS extraction_template text NOT NULL DEFAULT 'factory_report';

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_extraction_template_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_extraction_template_check
  CHECK (extraction_template IN ('general', 'factory_report', 'service_order'));

COMMENT ON COLUMN tenants.extraction_template IS
  'L2 業種模板 · general=僅通用核心 / factory_report=產線報工 / service_order=服務工單（待客戶欄位確認後啟用）· 一租戶一個（OQ-AAL-6）';

-- ============================================================
-- analysis_result · L2 區塊落地
-- ⚠️ design doc §4 原寫「不需 migration（analysis_result 是 jsonb）」是**錯的** ——
--    它是固定欄位（messages / daily_reports / records），不是單一 jsonb blob。
--    每個 L2 模板一個欄位：明確、好查、好做健康度聚合；上限 5 個模板故最多 5 欄。
-- ============================================================
ALTER TABLE analysis_result
  ADD COLUMN IF NOT EXISTS service_reports jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 這筆結果當時是用哪個模板抽的 · 換模板後仍可正確解讀歷史資料（可觀測性）
ALTER TABLE analysis_result
  ADD COLUMN IF NOT EXISTS extraction_template text;

COMMENT ON COLUMN analysis_result.extraction_template IS
  '產生這筆結果時租戶所用的 L2 模板 · null = 0030 之前的舊資料（一律視為 factory_report）';

COMMIT;
