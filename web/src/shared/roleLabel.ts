// 角色 → 中文顯示（中文優先鐵則 · 單一來源避免各視圖走鐘）
//
// ⚠️ 為什麼要有這個檔：同一個角色原本全站有**三套**叫法 ——
//   group_owner：成員頁「部門主管」/ 權限管理「群組負責人」/ 稽核記錄「群組負責人」
//   employee  ：成員頁「員工」    / 權限管理「一般員工」  / 稽核記錄「同仁」
// 客戶在權限管理設定「群組負責人」，回到成員頁卻只看到「部門主管」，
// 於是合理地以為那是兩個不同的角色、以為權限沒生效。
//
// ⚠️ 根因值得記著：`d06ea9a`（2026-07-30）把「群組負責人」改成「部門主管」時
// 標明「label only · DB 不動」—— 那在當時是對的，因為沒有任何畫面在讀
// `roles.role_name`。2026-08-21 權限管理頁開始讀它，那個前提就破了。
// **判準：改顯示名時要問的不是「現在誰在讀」，而是「這個值會不會變成 user-visible」。**
// DB 側由 migration 0069 對齊，本檔是前端側的單一來源。
export const ROLE_LABEL: Record<string, string> = {
  aiproot_admin: "AIPROOT 管理員",
  consultant: "顧問",
  tenant_admin: "總經理室",
  group_owner: "部門主管",
  assistant: "助理",
  employee: "員工",
};

/** 未知值 fallback 原值 —— 不吞資料，但至少看得出來是沒對應到 */
export const roleLabel = (r: string | null | undefined): string =>
  r ? (ROLE_LABEL[r] ?? r) : "";
