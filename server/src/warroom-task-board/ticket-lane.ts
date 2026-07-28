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
