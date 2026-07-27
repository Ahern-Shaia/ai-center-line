// Zod 抽取 schema · 資料契約（CLAUDE.md R12）
// ⚠️ Backend self-contained copy — keep in sync with ../../../../../src/schemas.ts
//
// 分層見 docs/modules/ai-analysis-layering.md（v1.0 APPROVED）：
//   L1 通用核心 = classifications + records  ← 本檔 · 所有租戶共用、不可關
//   L2 業種模板 = ./templates.ts             ← 每租戶選一個
import { z } from "zod";
import { TEMPLATE_REGISTRY, type ExtractionTemplate } from "./templates.js";

// WTB-M2 · category 從 enum 開放為 free string · 靠 category_registry 收斂
// 舊 CategoryEnum 保留為 default 建議清單 · pipeline system prompt 提示 LLM 優先歸入已知
export const CategoryEnum = z.enum([
  "daily_report",
  "attendance",
  "maintenance",
  "rnd",
  "procurement",
  "chitchat",
]);
export type Category = z.infer<typeof CategoryEnum>;
export const DEFAULT_CATEGORIES = CategoryEnum.options;

const Confidence = z.enum(["high", "medium", "low"]);

// ── L1 通用核心 ──────────────────────────────────────────────────
// 台灣福祉 6 天實測填充率：status 100% / person 72% / title,detail ~100%
// 這幾個欄位在任何行業都成立，所以放 L1；機台(7%)/工單(8%) 只在產線成立 → L2
const classificationSchema = z.object({
  id: z.number(),
  category: z.string().min(1).max(100),   // WTB-M2 · 開放 · 由 category_registry 收斂
  confidence: Confidence,
});

const recordSchema = z.object({
  category: z.string().min(1).max(100),    // WTB-M2 · 開放
  title: z.string(),
  detail: z.string(),
  status: z.enum(["open", "in_progress", "resolved", "info"]).nullable(),
  person: z.string().nullable(),
  machine_code: z.string().nullable(),
  work_order: z.string().nullable(),
  source_ids: z.array(z.number()),
  confidence: Confidence,
});

/** L1 追蹤欄位 · 健康度儀表用（跨模板共用）*/
export const L1_TRACKED_FIELDS = ["person", "status", "machine_code", "work_order"] as const;

/**
 * 依模板組出該租戶的抽取 schema。
 * L1 一定在；L2 依 tenants.extraction_template 決定，general 則沒有 L2 區塊。
 */
export function buildAnalysisSchema(template: ExtractionTemplate) {
  const def = TEMPLATE_REGISTRY[template];
  const base = {
    classifications: z.array(classificationSchema),
    records: z.array(recordSchema),
  };
  if (!def.resultKey || !def.schema) {
    return z.object(base);
  }
  return z.object({ ...base, [def.resultKey]: z.array(def.schema) });
}

// 既有呼叫端與回歸樣本沿用（＝ factory_report 模板）· 行為不變
export const AnalysisResult = buildAnalysisSchema("factory_report");

export type AnalysisResultT = {
  classifications: z.infer<typeof classificationSchema>[];
  records: z.infer<typeof recordSchema>[];
  daily_reports?: Array<Record<string, unknown>>;
  service_reports?: Array<Record<string, unknown>>;
};
