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
  // 2026-08-25 新增 · 依 prod 真實資料（台灣福祉 9 張 production_meeting）：
  //   內建清單原本**沒有會議**，模型看到生產會議的決議事項無處可歸，
  //   就自己造了英文 slug `production_meeting` —— 那正是 08-24 中英混雜的來源之一。
  //   缺的不是「會議這個主題」，是「工位車輛更換 / 複檢 / QC 指派」這類
  //   **會議產出的協調事項**在八個主題分類裡都不成立。
  // ⚠️ 判別軸見 tenant prompt 分類規則 7：**主題優先**，
  //    會議上談的維保仍是 maintenance —— 否則要找維保時就找不到它了。
  "meeting",
  // 2026-08-25 · 同一批 prod 實查（台灣福祉 3 張 facility_management）：
  //   停車場坑洞、監視器加裝、參訪的網路佈線 —— 都不是 maintenance 定義的
  //   「車輛／產線設備／治具」，也不是 it_support 的「帳號與軟體操作」。
  //   ⭐ slug **刻意沿用 AI 造的 `facility_management`**：它本來就夠通用，
  //      缺的只是沒在內建清單裡所以沒有中文名 —— 沿用等於零資料遷移。
  //      （`production_meeting` 要改成 `meeting` 是因為它帶了業種色彩，這裡沒有。）
  // ⚠️ 判別軸見分類規則 8。
  "facility_management",
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
  meeting: "會議記錄",
  facility_management: "廠區設施",
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
  /**
   * 這件事**什麼時候要做**（calendar-sync 階段 A · 2026-09-01）。
   *   due_at   ISO 日期或日期時間；沒有講到未來日期就給 ""
   *   due_text 原文寫法（「8/24 14:00」「下週三」「月底前」）；沒有就給 ""
   *
   * ⚠️⚠️ **刻意不用 `.nullable()`** —— Anthropic 結構化輸出的 16 union 上限
   *    數的是產生出來的 JSON Schema 裡的 anyOf/enum，
   *    **不可空欄位是 0 成本**（實測：scripts/probe-union-limit.ts）。
   *    預設模板 factory_report 現況 15/16，只剩 1 格；
   *    寫成 nullable 會白白吃掉它，之後任何人加欄位就會讓**整條分析 400**。
   *
   * ⚠️ R11 的紀律沒有放寬：抽不到給 `""`，**絕不換算或臆測**。
   *    「下週三」不知道是幾號 → due_at="" · due_text="下週三"。
   *    已實測 5/5（scripts/probe-due-nonnullable.ts），含最容易誤填的
   *    「今天做完的事」與「模糊時間詞」兩題。
   */
  due_at: z.string(),
  due_text: z.string(),
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
