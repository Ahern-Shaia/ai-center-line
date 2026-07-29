// L2 業種模板註冊表 · 對照 docs/modules/ai-analysis-layering.md（v1.0 APPROVED）
//
// 三層模型：
//   L1 通用核心  classifications + records（誰/什麼事/當責人/狀態/信心度/可溯源）
//                所有租戶共用、不可關 —— 台灣福祉實測填充率 72–100%
//   L2 業種模板  本檔 —— 每租戶選一個（tenants.extraction_template）
//   L3 租戶詞彙  主檔資料（人員/車型/客戶），走 masterData，不在本檔
//
// ⚠️ 新增模板前先讀 doc §3「商業紀律」：模板要能開一個**垂直市場**才做。
//    每家客戶一個模板＝接案不是 SaaS。上限 5 個（OQ-AAL-3）。
import { z } from "zod";

export const EXTRACTION_TEMPLATES = ["general", "factory_report", "service_order"] as const;
export type ExtractionTemplate = (typeof EXTRACTION_TEMPLATES)[number];

export const DEFAULT_TEMPLATE: ExtractionTemplate = "factory_report";

const Confidence = z.enum(["high", "medium", "low"]);

// ── L2 · 產線報工型（工廠：機台/工單/產出/不良/工時）────────────────
const factoryReportSchema = z.object({
  date: z.string().nullable(),
  reporter_name: z.string().nullable(),
  reporter_code: z.string().nullable(),
  line: z.string().nullable(),
  machine_code: z.string().nullable(),
  work_order: z.string().nullable(),
  output_qty: z.number().nullable(),
  defect_qty: z.number().nullable(),
  work_hours: z.number().nullable(),
  overtime_hours: z.number().nullable(),
  issues: z.string().nullable(),
  source_ids: z.array(z.number()),
  confidence: Confidence,
});

// ── L2 · 服務工單型（客戶/車輛/施作項目/金額）──────────────────────
// ⚠️ 尚未啟用（selectable: false）。
//    v0.2（2026-07-30）：欄位已**用 prod 真實資料量出來**，不再是憑想像的草案 ——
//    8 天內 9 則「今日進度回報」固定格式，量出三個要加（items 的 vehicle/status/warranty）
//    與三個不加（聯絡人/電話 只 2 則且是 PII、業務分區屬主檔、車牌併入 vehicle）。
//    詳見 docs/modules/extraction-schema-service-order.md §3.4／§3.5。
//    要開放前仍需裁定 OQ-ESO-2..10。
const serviceOrderSchema = z.object({
  date: z.string().nullable(),
  reporter: z.string().nullable(),
  customer: z.string().nullable(),          // 客戶／案場：屏東恆基醫院、嘉義安道基金會
  site: z.string().nullable(),              // 站點：朴子站、長庚站（同一客戶多站點）
  items: z.array(z.object({
    name: z.string(),                       // 施作項目：主機馬達查修、更換右後鏡頭
    qty: z.number().nullable(),             // 「一台」→ 1
    amount: z.number().nullable(),          // 金額只抄不算（R11）
    // ⚠️ 以下三個是 v0.2 依 prod 真實資料補的（doc §3.4）——
    //    9 則「今日進度回報」量出來的，不是憑想像加的。
    vehicle: z.string().nullable(),         // 車型／車號 · **在項目層**：同一客戶可能多台不同車
    status: z.string().nullable(),          // 該項目自己的狀態：待報價單同意後維修／待領料安裝／安排中
    warranty: z.string().nullable(),        // 保內／保外 · **原文照抄**：我方沒有保固起訖資料，不可自行判斷
  })),
  // ⚠️ record 層仍留一個 status，但細節看 items[].status ——
  //    真實案例：同一客戶「洽談側踏（待領料安裝）」與「保養一台（已完成）」狀態不同，
  //    record 層只有一個欄位時會丟掉其中一個。
  status: z.string().nullable(),
  issues: z.string().nullable(),
  source_ids: z.array(z.number()),
  confidence: Confidence,
});

interface TemplateDef {
  /** 中文名 · 前端顯示 */
  label: string;
  /** 一句話說明「什麼樣的客戶該選這個」 */
  description: string;
  /** 存進 analysis_result 的哪個 key（null = 此模板不產生 L2 區塊）*/
  resultKey: "daily_reports" | "service_reports" | null;
  /** L2 區塊的 zod schema（null = 無）*/
  schema: z.ZodTypeAny | null;
  /** 注入 system prompt 的抽取規則片段 */
  promptFragment: string;
  /** 健康度儀表要追蹤哪些欄位的填充率 */
  trackedFields: string[];
  /** 是否可在前端選用（service_order 待客戶欄位確認）*/
  selectable: boolean;
}

export const TEMPLATE_REGISTRY: Record<ExtractionTemplate, TemplateDef> = {
  general: {
    label: "通用（僅核心欄位）",
    description: "只抽「誰、什麼事、當責人、狀態」。業種模板還沒建立、或該客戶的回報格式尚未確定時用。",
    resultKey: null,
    schema: null,
    promptFragment: "",
    trackedFields: [],
    selectable: true,
  },
  factory_report: {
    label: "產線報工型",
    description: "工廠、產線。回報內容是機台、工單、產出數、不良數、工時。",
    resultKey: "daily_reports",
    schema: factoryReportSchema,
    promptFragment: `

## 抽取規則（產線報工）
8. daily_reports：只放產線報工日報的結構化資料。一則日報若涵蓋多台車或多個工位，拆成多筆。
9. reporter_code 填主檔人員代碼、machine_code 填工位站碼（ST-xx）、work_order 填改裝案號（CV-xxxx）或車號。
10. 改裝情境通常沒有產量/不良數，output_qty 與 defect_qty 無明確數字時一律填 null。

## 範例（產線報工）
輸入訊息：
#3 [2026-07-02 18:20] 阿源: 7/2改裝日報 阿源 示範車號A 輪椅升降機水平調校2.5h、斜坡板焊接1.5h ⏎ 備註:鋼索已換標準件 平台恢復正常
對應輸出（節錄）：
- daily_reports 含 {date: "2026-07-02", reporter_name: "王○○", reporter_code: "P-02", line: null, machine_code: "ST-01", work_order: "示範車號 A", output_qty: null, defect_qty: null, work_hours: 2.5, overtime_hours: null, issues: "另斜坡板焊接1.5h；鋼索已換標準件、平台恢復正常", source_ids: [3], confidence: "high"}
- 斜坡板焊接屬車體/焊接工位，可另拆一筆 daily_report（machine_code: "ST-03", work_hours: 1.5）。`,
    trackedFields: ["machine_code", "work_order", "work_hours", "reporter_code"],
    selectable: true,
  },
  service_order: {
    label: "服務工單型",
    description: "維修、派工、到府服務。回報內容是客戶／案場、車輛、施作項目與金額。",
    resultKey: "service_reports",
    schema: serviceOrderSchema,
    promptFragment: `

## 抽取規則（服務工單）
8. service_reports：服務工單回報（「今日工作內容回報」「今日進度回報」這類訊息）。
9. 一則訊息常含**多個客戶／案場**，每個客戶拆成一筆；同一客戶的多個施作項目放進 items 陣列。
10. 金額只抄不算 —— 原文寫多少就填多少，禁止加總、換算或推估（R11）。
11. status 用原文語意（如「待領料安裝」「待討論」「完成」），不要自行歸類成代碼。`,
    trackedFields: ["customer", "vehicle", "status"],
    selectable: false,   // ⚠️ 待客戶欄位確認（OQ-ESO-1）
  },
};

export function resolveTemplate(value: string | null | undefined): ExtractionTemplate {
  return (EXTRACTION_TEMPLATES as readonly string[]).includes(value ?? "")
    ? (value as ExtractionTemplate)
    : DEFAULT_TEMPLATE;
}
