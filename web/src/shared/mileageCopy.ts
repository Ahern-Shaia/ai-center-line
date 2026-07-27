// 里程相關的共用文案。打卡頁與「我的行程」都要講同一套說法，
// 分開寫遲早會兩邊不一致（使用者在兩個畫面看到不同解釋，比沒解釋更糟）。
//
// ⚠️ 這個數字要與後端 SAME_LOCATION_THRESHOLD_M 一致
//    （server/src/attendance/attendance.service.ts）。改一邊要改兩邊。
export const SAME_LOCATION_M = 20;

/** 一句話標籤 · 表格/清單用 */
export const SAME_LOCATION_LABEL = "原地打卡";

/** 為什麼是 0 · 給電腦小白看，不用術語 */
export const SAME_LOCATION_WHY =
  `兩次打卡相距不到 ${SAME_LOCATION_M} 公尺，系統當成在同一個地方，所以不算里程。`;

/** 手機定位本來就有誤差 —— 講清楚這是保護不是苛扣 */
export const SAME_LOCATION_REASON =
  "手機定位本來就有幾公尺誤差，人站著不動、位置也會飄。太近的距離不算，是避免多出根本沒跑的里程。";

/** 下一步該做什麼 */
export const SAME_LOCATION_NEXT =
  `走到別的地點（距離超過 ${SAME_LOCATION_M} 公尺，大約 25 步以上）再按一次，就會算出實際路程。`;
