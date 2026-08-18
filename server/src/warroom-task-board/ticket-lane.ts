// 任務分區的單一判準 · docs/modules/task-materialization-gate.md §2
//
// 為什麼要有這個檔：門檻改動會同時影響材料化、看板、簽核率、健康度、個人日報五個地方。
// 判斷散在各處遲早會漂移（有的算了中信心、有的沒算），簽核率是給總經理看的主指標，
// 漂移一次就沒人信了。所以判準只寫一次，全部從這裡取。

/** 簽核佇列狀態 · DB 的 tickets.confirm_status */
export type ConfirmStatus = "待簽核" | "已簽核" | "逾時警示" | "待確認" | "已忽略" | "存查";

/** 記錄本身的狀態 · DB 的 tickets.status（來自 AI 抽取） */
export type RecordStatus = "open" | "in_progress" | "resolved" | "info";

/**
 * 在簽核佇列內的狀態 —— **簽核率與健康度只算這些**。
 * 待確認（還沒決定是不是任務）、已忽略、存查（公告/已完成）都不算，
 * 否則部門永遠無法「全部簽完」，簽核率會卡在 0%。
 */
export const SIGNOFF_SCOPE: readonly ConfirmStatus[] = ["待簽核", "已簽核", "逾時警示"];

export function inSignoffScope(s: string | null | undefined): boolean {
  return SIGNOFF_SCOPE.includes(s as ConfirmStatus);
}

/** 這件事還要不要做？公告與已完成的事都不用。 */
export function isActionable(status: string | null | undefined): boolean {
  return status === "open" || status === "in_progress";
}

/**
 * 一筆抽取記錄該進哪一區。null = 不建卡。
 *
 * 兩個維度分開看：
 *   confidence 回答「抽得準不準」· status 回答「該不該追」
 * 先前只用 confidence 當門檻，才會讓「開會通知」這種抽得很準的公告去排隊等簽核。
 */
export function laneFor(
  confidence: string | null | undefined,
  status: string | null | undefined,
): ConfirmStatus | null {
  if (confidence === "high") {
    // 公告與已完成的事不進佇列，但**還是建卡**——直接擋掉的話，
    // AI 只要把一件真待辦誤標成 info，那件事就無聲消失（doc F-1 · P0）。
    return isActionable(status) ? "待簽核" : "存查";
  }
  if (confidence === "medium") {
    // 中信心佔 64%，其中該追的（open/in_progress）交給主管定奪；
    // 中信心的公告與已完成事項價值低於打擾成本，不建卡。
    return isActionable(status) ? "待確認" : null;
  }
  // low：訊息本身就模糊，13 筆／6 天，成本高於價值（OQ-TMG-8）
  return null;
}

/** 重跑時可以被自動重算的區 —— 人動過的（已簽核／已忽略／逾時）一律保留 */
export const RECOMPUTABLE_LANES: readonly ConfirmStatus[] = ["待簽核", "待確認", "存查"];

// ── 0036 · 第四條軸與對外顯示 ────────────────────────────────────────
// docs/modules/task-completion-tracking.md §4.3

/** 工作狀態 · 擁有者是當責人本人 · DB 的 tickets.work_status */
/** record = 不進工作生命週期（紀錄類分類 0063、或 AI 判為純資訊）*/
export type WorkStatus = "open" | "closed" | "record";

/** 紀錄類分類 · 日報／出勤／閒聊本來就不是待辦（0063）*/
export const RECORD_CATEGORIES: ReadonlySet<string> = new Set(["daily_report", "attendance", "chitchat"]);

/**
 * 這張卡要不要進工作生命週期（個人待辦、LINE 完成回報、結案率）。
 *
 * 兩個入口，判準都在這裡（本檔的存在理由：判準只寫一次）：
 *   1. 紀錄類分類（0063）—— 日報是「已經做完的紀錄」，對它說「尚未確認完成」讀不通
 *   2. status === "info" —— AI 判為純資訊／公告。經驗提醒、法規說明、選型結論
 *      都不是「某人要去做的事」，不該躺在誰的待辦清單裡等人按完成。
 *
 * ⚠️ resolved **不**在這裡擋（2026-08-18 用戶裁定採保守版）。
 *    「AI 從對話讀到好了」是推論不是本人的承諾 —— 留在 open 讓當事人確認，
 *    displayState 會顯示「AI 判讀已完成 · 尚未確認」，跟這個產品的簽核理念一致。
 *
 * 注意這條軸跟 laneFor（confirm_status）是**分開**的：laneFor 早就用 status 擋掉了
 * 簽核佇列（info/resolved → 存查 或不建卡），但那只影響簽核率與健康度；
 * 個人待辦是讀 work_status，所以那一層要在這裡各自擋。
 */
export function workStatusFor(
  category: string | null | undefined,
  status: string | null | undefined,
): WorkStatus {
  if (RECORD_CATEGORIES.has(category ?? "")) return "record";
  if (status === "info") return "record";
  return "open";
}

/** 為什麼結束 · DB 的 tickets.work_outcome（Jira 的 resolution 模型） */
export type WorkOutcome = "完成" | "不用做了" | "轉他人" | "做不到";

/**
 * ⚠️ 完成率的分母要排除「不用做了」——
 * 否則「取消一堆」會被算成「做完一堆」（Linear 的 canceled 也是這樣處理）。
 */
export function countsTowardCompletion(outcome: string | null | undefined): boolean {
  return outcome !== "不用做了";
}

export interface DisplayStateInput {
  workStatus?: string | null;
  workOutcome?: string | null;
  workLastReportAt?: Date | string | null;
  workAskedAt?: Date | string | null;
  confirmStatus?: string | null;
  assignStatus?: string | null;
  status?: string | null;
}

/**
 * 四條軸 → 對外顯示的**一個**狀態。
 *
 * 為什麼要投影：四軸全正交 = 3×3×3×2 種組合，大多數無意義。
 * 把四個下拉並排丟給現場主管，沒人看得懂。所以存四軸、只顯示一個字。
 * （JSM／ServiceNow 前台那條鏈也是投影，底下是獨立的簽核物件。）
 *
 * ⚠️ 措辭鐵則（doc §2.5 · F-26）：對外一律「**尚未確認完成**」，不用「未完成」。
 *    前者說的是系統的認知（永遠為真）；後者說的是工作狀態，
 *    人做完但還沒回報時它就是**假的**——他會因此不再信任提醒。
 *    這裡是單一事實來源，其他地方不得自行造詞。
 */
export function displayState(t: DisplayStateInput): string {
  if (t.workStatus === "closed") {
    return t.workOutcome === "完成" ? "已完成" : `已結束（${t.workOutcome ?? "未註明"}）`;
  }
  if (t.confirmStatus === "待確認") return "待確認是不是任務";
  if (t.confirmStatus === "已忽略") return "已忽略";
  if (t.confirmStatus === "存查") return "存查";
  if (t.assignStatus !== "assigned") return "待指派";
  // AI 從對話讀到「好了」是**推論**，不是本人的**承諾** —— 講出這個落差，不要替他結案
  // （同 ITIL 的 resolved vs closed：技師標 resolved、使用者確認才 closed）
  if (t.status === "resolved") return "AI 判讀已完成 · 尚未確認";
  if (t.workAskedAt) return "已詢問 · 待本人確認";
  if (t.workLastReportAt) return "進行中（有回報）";
  return "進行中";
}
