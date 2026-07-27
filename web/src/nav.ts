import { getSession } from "./api";

// App 的路由是 useState，沒有 URL routing。
// 深層元件（TaskBoard / DailyLog）要跨頁導到「分析詳情」時原本寫
//   window.location.hash = "#/convo-detail/N"
// 但 App 從來沒有監聽 hashchange —— 點了完全沒反應（2026-07-27 客戶回報）。
//
// 改用事件而不是 hash 的理由：hash 值相同時 hashchange 不會再觸發，
// 使用者導開之後再點同一張卡就又失效一次，比現在更難察覺。
export const NAV_EVENT = "app:navigate";

export interface NavTarget {
  page: "convo-detail";
  uploadId: number;
}

export function navigateTo(target: NavTarget): void {
  window.dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: target }));
}

/**
 * 這個角色點下去到得了嗎？
 * convo-detail 屬 AIPROOT_ONLY_PAGES，非 aiproot/consultant 會被 App 的 route guard
 * 彈回預設頁 —— 那看起來還是「壞掉」。到不了就別顯示連結。
 * ⚠️ 總經理室是任務看板的主要使用者，卻看不到來源對話，是產品層待決的問題。
 */
export function canOpenConvoDetail(): boolean {
  const role = getSession()?.role;
  return role === "aiproot_admin" || role === "consultant";
}
