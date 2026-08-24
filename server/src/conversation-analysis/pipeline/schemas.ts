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
  // 2026-07-30 新增兩類 · 依 prod 真實資料（docs/抽取健康度分析報告-2026-07-30.md §6.2）：
  //   procurement 的定義原本含「詢價、報價」，客戶詢價因此被歸進採購 ——
  //   模型是照著 prompt 做，但「我方付錢」與「客戶付錢」混在一類，
  //   結果「這個月採購多少」與「接了多少詢價」兩個都算不出來。
  //   maintenance 同理掃進了 NAS／ERP 帳號問題（定義含「設備／工具異常」）。
  // ⚠️ 判別軸寫在 tenant prompt 的分類規則 5、6 —— 加類別時要一起維護那兩條，
  //    只加清單不給判別軸，模型會在邊界上亂猜。
  "sales",
  "it_support",
  "chitchat",
]);
export type Category = z.infer<typeof CategoryEnum>;
export const DEFAULT_CATEGORIES = CategoryEnum.options;

/**
 * 內建分類的中文名 · 與 `web/src/shared/categoryLabel.ts` 的 CATEGORY_LABEL 一致。
 *
 * ⚠️⚠️ 為什麼後端也要有一份：`loadKnownCategories` 在 registry 空的時候
 *    回的是 `{slug, name: slug}` —— 於是 prompt 裡的「已知分類」變成
 *    `- daily_report (daily_report)` 一整排英文。模型看著這個樣板造新分類，
 *    自然生出 `production_meeting` / `document_control` 這種英文 slug，
 *    然後直接印在客戶畫面上（2026-08-24 台灣福祉實際踩到）。
 *
 *    **中文名不能只存在前端** —— 模型看得到的是後端這一份。
 */
export const DEFAULT_CATEGORY_NAMES: Record<string, string> = {
  daily_report: "報工日報",
  attendance: "出勤異動",
  chitchat: "閒聊",
  maintenance: "維保異常",
  rnd: "研發討論",
  procurement: "採購",
  sales: "業務",
  it_support: "資訊支援",
};

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
