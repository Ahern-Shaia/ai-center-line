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
// v0.2（2026-07-30）：欄位已**用 prod 真實資料量出來**，不再是憑想像的草案 ——
// 8 天內 9 則「今日進度回報」固定格式，量出三個要加（items 的 vehicle/status/warranty）
// 與三個不加（聯絡人/電話 只 2 則且是 PII、業務分區屬主檔、車牌併入 vehicle）。
// 詳見 docs/modules/extraction-schema-service-order.md §3.4／§3.5。
// OQ-ESO-2..10 仍開放，但那些是「抽出來之後怎麼用」（下游消費、Ragic 欄位對應），
// 不阻擋開始抽 —— 現在不抽，這幾天的客戶／金額／項目結構就永久沒有。
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

// ── L2 · 服務工單型的第二區塊：客服報修派工單（service_intake）──────
// 設計見 docs/modules/extraction-schema-service-intake.md。
// ⚠️ v2：這是**獨立的第二次 LLM 呼叫**，不併進 service_order 主 output schema ——
//    併進去會讓整包 union 參數超過 Anthropic ≤16 上限、API 回 400（見 doc §3.6 / FMEA F-10）。
//    本 schema 單獨算約 11 個 union（9 nullable + array + enum），在上限內。
const serviceIntakeSchema = z.object({
  date: z.string().nullable(),
  customer: z.string().nullable(),      // 客戶：祝三、台中智障者協會
  site: z.string().nullable(),          // 站點／地址區域（只存區域，完整地址屬 PII）
  vehicle: z.string().nullable(),       // 車種＋車牌合併原文：「VERYCA RFB-3630」
  warranty: z.string().nullable(),      // 是否保固內:是→保內／否→保外／未知→null · 讀明寫欄位非推斷
  issue: z.string().nullable(),         // 狀況：斜坡板放不下來
  status: z.string().nullable(),        // 派工狀態：待派工／待聯絡客戶／已安排
  contact: z.string().nullable(),       // 聯絡人姓名
  phone: z.string().nullable(),         // 電話 · 模型照抄完整號碼，落庫前 pipeline 遮罩尾三碼（見 maskIntakePhone）
  source_ids: z.array(z.number()),
  confidence: Confidence,
});

/**
 * service_intake.phone 遮罩 · PII 密度降低（ESI-2）。
 * ⚠️ 在 pipeline 後處理做 deterministic 遮罩，**不叫模型遮**——模型遮會不一致甚至改數字（違 R11）。
 * ⚠️ 這只降低「結構化欄位被批量撈」的風險；同一支號碼在 raw_content 仍是明文（見 doc §3.5）。
 */
export function maskIntakePhone(raw: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length < 4) return null;                 // 太短不像電話 · 不保留（也避免洩漏短碼）
  const last3 = d.slice(-3);
  if (d.length === 10 && d.startsWith("09")) return `09xx-xxx-${last3}`;
  return `${"x".repeat(d.length - 3)}${last3}`;
}

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
  /**
   * 選配 · 第二輸出區塊（目前只有 service_order → service_intake）。
   * ⚠️ v2：這是**獨立的第二次 LLM 呼叫**（自己的 schema + promptFragment），
   *    不併進主 schema —— 併進去會超過 Anthropic ≤16 union 上限（見 doc §3.6 / FMEA F-10）。
   * postProcess 在落庫前對該區塊每筆做 deterministic 後處理（如 phone 遮罩）。
   */
  extraSection?: {
    key: "service_intake";
    schema: z.ZodTypeAny;
    /** 第二次呼叫專用的抽取規則（接在 tenant.systemPrompt 後） */
    promptFragment: string;
    trackedFields: string[];
    postProcess?: (rec: Record<string, unknown>) => Record<string, unknown>;
  };
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
   客戶下面若有站點（如「朴子站」「長庚站」「辦公室」「民雄站」），填 site；同一客戶不同站點拆成不同筆。
10. 金額只抄不算 —— 原文寫多少就填多少，禁止加總、換算或推估（R11）。
11. **狀態分兩層，不要混**：
    - \`items[].status\`：**該項目自己的**狀態，用原文語意（「待領料安裝」「待報價單同意後維修」「安排中」「待討論」「完成」）。
      這是主要要填的 —— 同一客戶常常一項待料、另一項已完成。
    - 最外層的 \`status\`：**只在整則有一個共同結論時才填**（例：整則都是「已完成」）。
      各項目狀態不同時，最外層填 null，不要挑一個代表。
12. \`items[].vehicle\`：車型或車號，**寫在項目上**（同一個客戶可能有多台不同車）。
    例：「旅玩家查修一台」→ vehicle: "旅玩家"；「JS斜坡板止滑膠帶除膠」→ vehicle: "JS"。
    項目沒提到車就填 null，不要從別的項目借。
13. \`items[].warranty\`：**只在訊息裡明講時才填**，原文照抄（「保內」「保固內」「保外」）。
    ⚠️ 我方沒有保固起訖資料，**禁止自行判斷**是否在保固期內。沒寫就是 null。
14. 一則回報裡常有不屬於任何客戶的項目（「線上週會議」「部門週會」「公務車保養」「文件整理」「前往花蓮」）。
    這些 customer 填 null，仍可各自成一筆或併入 issues —— 不要硬塞給前一個客戶。`,
    // ⚠️ 只放**record 層**的欄位。抽取健康度的 fieldFill 是
    //    `jsonb_array_elements(service_reports) item` → `item->>field`，只看得到 record 層。
    //    v0.2 把 vehicle 移到 items[] 之後若還留在這裡，健康度會永遠顯示 0% ——
    //    那是量錯地方，不是抽不到，會讓人去修一個沒壞的東西。
    //    ⚠️ 也刻意不放 status：規則 11 要模型優先填 items[].status，
    //    record 層的 status 本來就常是 null。
    //    ⏳ 待補：item 層欄位（vehicle / status / warranty / amount）目前**沒有被健康度量到**，
    //       需要 fieldFill 支援嵌套路徑 —— 見 docs/抽取健康度分析報告-2026-07-30.md M2。
    trackedFields: ["customer", "site"],
    // OQ-ESO-1（欄位是否對）已用 prod 真實資料回答 —— 見 §3.4／§3.5。
    // 開放的另一個理由：關著的時候切換端點會擋，改模板得繞去 prod 手動下 SQL，
    // 而 tenants 的 RLS 會讓漏設 session 變數的 UPDATE 靜默回 0 列（2026-07-30 實際踩到）。
    selectable: true,
    // 第二區塊：客服報修派工單 · warranty 只在這裡（見 extraction-schema-service-intake.md）。
    // ⚠️ 獨立第二次 LLM 呼叫（不併主 schema）· promptFragment 是那次呼叫的專屬規則。
    extraSection: {
      key: "service_intake",
      schema: serviceIntakeSchema,
      trackedFields: ["customer", "warranty"],   // 健康度接嵌套路徑後啟用（M3），目前未接
      postProcess: (rec) => ({ ...rec, phone: maskIntakePhone((rec.phone as string | null) ?? null) }),
      promptFragment: `
## 本次任務：只抽「客服報修派工單」→ service_intake
你這次**只需要**把訊息裡的**客服報修派工單**抽成 service_intake 陣列，其他都不用管。

1. 報修派工單 = **冒號標籤表單**，連續多行如「客戶:／聯絡人:／電話:／車種:／車牌:／是否保固內:／地址:／狀況:」。
   這是客服貼出、描述「待處理」維修需求的單子（狀態在派工前）。
   ⚠️ **師傅的「今日進度回報／今日工作內容回報」不是報修單**，那種**一律略過、不要放進 service_intake**。
2. 訊息裡**沒有**報修派工單時，service_intake 回**空陣列**。不要把進度回報或閒聊硬塞進來。
3. 欄位對照表單原文：客戶→customer、聯絡人→contact、電話→phone（照抄完整號碼，系統會自動遮罩）、
   車種＋車牌→vehicle（合併原文，如「VERYCA RFB-3630」）、地址→site（只取區域如「板橋」）、狀況→issue。
4. warranty 由「是否保固內」映射：是→「保內」、否→「保外」、未知／空白→null。
   這是**讀取表單明寫的欄位值**，不是推斷保固期 —— 沒有此欄就 null，仍禁止自行判斷。
5. status 填派工狀態原文語意（待派工／待聯絡客戶／已安排），沒有就 null。
6. 缺漏欄位一律 null（不可省略 key）；source_ids 必填、可回溯（R11）。`,
    },
  },
};

export type ExtraSection = NonNullable<TemplateDef["extraSection"]>;

export function resolveTemplate(value: string | null | undefined): ExtractionTemplate {
  return (EXTRACTION_TEMPLATES as readonly string[]).includes(value ?? "")
    ? (value as ExtractionTemplate)
    : DEFAULT_TEMPLATE;
}
