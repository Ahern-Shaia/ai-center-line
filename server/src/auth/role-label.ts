// 角色 → **i18n key**（伺服器側單一來源）· 用 msg() 取實際文字
//
// ⚠️ 2026-08-27 M4b：值從中文字面改成 key。**所有讀這張表的地方都要包 msg()** ——
//    忘了包會直接把 `srv.role.tenant_admin` 印給客戶看，而 tsc 不會擋（兩邊都是 string）。
//
// 與 `web/src/shared/roleLabel.ts`、DB `roles.role_name`（migration 0069）**三者必須一致**。
// 同一個角色曾經有三套叫法：成員頁「部門主管」/ 權限管理「群組負責人」/ 稽核記錄「群組負責人」，
// 客戶看到的是「這是不是兩個不同的角色」。
//
// ⚠️ 這裡是**靜態表而不是查 `roles` 表**：稽核記錄存的是當下的角色字串快照，
// 那個角色事後可能被改名或刪掉，查表會讓歷史紀錄跟著變 —— 稽核要的是當時的事實。
export const ROLE_LABEL: Record<string, string> = {
  aiproot_admin: "srv.role.aiproot_admin",
  consultant: "srv.role.consultant",
  tenant_admin: "srv.role.tenant_admin",
  group_owner: "srv.role.group_owner",
  assistant: "srv.role.assistant",
  employee: "srv.role.employee",
};

/** 稽核記錄專用：多一個非角色的 `system`（排程／自動流程做的事） */
export const AUDIT_ACTOR_LABEL: Record<string, string> = {
  ...ROLE_LABEL,
  system: "srv.role.system",
};
