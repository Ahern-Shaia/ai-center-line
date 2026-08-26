import { t } from "../i18n";
// 里程相關的共用文案。打卡頁與「我的行程」都要講同一套說法，
// 分開寫遲早會兩邊不一致（使用者在兩個畫面看到不同解釋，比沒解釋更糟）。
//
// ⚠️ 這個數字要與後端 SAME_LOCATION_THRESHOLD_M 一致
//    （server/src/attendance/attendance.service.ts）。改一邊要改兩邊。
export const SAME_LOCATION_M = 20;

/** 一句話標籤 · 表格/清單用 */
// ⚠️ 這四個是**函式**不是常數 —— const 會在 module load 當下定值，
//    切語言時不會重算，畫面會卡在進站當下那個語言。
export const SAME_LOCATION_LABEL = () => t("mc.sameLocation");

/** 為什麼是 0 · 給電腦小白看，不用術語 */
export const SAME_LOCATION_WHY = () => t("mc.why", { m: SAME_LOCATION_M });

/** 手機定位本來就有誤差 —— 講清楚這是保護不是苛扣 */
export const SAME_LOCATION_REASON = () => t("mc.reason");

/** 下一步該做什麼 */
export const SAME_LOCATION_NEXT = () => t("mc.next", { m: SAME_LOCATION_M });
