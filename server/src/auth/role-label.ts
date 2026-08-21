// 角色 → 中文顯示（伺服器側單一來源）
//
// 與 `web/src/shared/roleLabel.ts`、DB `roles.role_name`（migration 0069）**三者必須一致**。
// 同一個角色曾經有三套叫法：成員頁「部門主管」/ 權限管理「群組負責人」/ 稽核記錄「群組負責人」，
// 客戶看到的是「這是不是兩個不同的角色」。
//
// ⚠️ 這裡是**靜態表而不是查 `roles` 表**：稽核記錄存的是當下的角色字串快照，
// 那個角色事後可能被改名或刪掉，查表會讓歷史紀錄跟著變 —— 稽核要的是當時的事實。
export const ROLE_LABEL: Record<string, string> = {
  aiproot_admin: "AIPROOT 管理員",
  consultant: "顧問",
  tenant_admin: "總經理室",
  group_owner: "部門主管",
  assistant: "助理",
  employee: "員工",
};

/** 稽核記錄專用：多一個非角色的 `system`（排程／自動流程做的事） */
export const AUDIT_ACTOR_LABEL: Record<string, string> = {
  ...ROLE_LABEL,
  system: "系統",
};
