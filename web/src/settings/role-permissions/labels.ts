// 權限的「畫面呈現」設定 · docs/mockup/tenant-role-permissions.html §4
//
// 為什麼分組寫在前端而不是資料庫：
// 資料庫的 `resource` 是**資料表的分法**（audit / binding / scheduler-config），
// 而使用者認得的是**側邊欄的分法**（戰情室 / 部門與成員 / 自動化）。
// 這是呈現層的決定，放前端；後端不必知道畫面怎麼分組。
//
// 說明句（why）同理：資料庫的 description 已經是白話（0067 改寫過），
// 這裡只補「不明顯的那幾項」——「查看知識庫」不必解釋，「核對項目」要講清楚在確認什麼。

/** 分組順序＝側邊欄順序。沒列到的權限會落到「其他」，那代表這張表該補了。 */
// ⚠️ 2026-08-26 i18n：title 與 hint 改存 **key**，文字在 i18n/*.ts。
//    分組是「側邊欄的分法」不是資料表的分法 —— 那個決定不變，只是文字搬家。
export const PERMISSION_GROUPS: Array<{ title: string; ids: string[] }> = [
  {
    title: "permGroup.warroom",
    ids: [
      "warroom:view", "warroom-tasks:view", "warroom-daily:view",
      "signoff:view", "signoff:action", "personal-report:team",
    ],
  },
  {
    title: "permGroup.data",
    ids: ["rag:view", "media:view", "km:view", "map:view"],
  },
  {
    title: "permGroup.personal",
    ids: ["personal-report:mine", "trips:mine"],
  },
  {
    title: "permGroup.people",
    ids: ["departments:view", "departments:manage-tenant", "users:view", "users:create-group-owner"],
  },
  {
    title: "permGroup.lineGroups",
    ids: ["line-groups:view", "binding:view"],
  },
  {
    title: "permGroup.taskConfig",
    ids: ["categories:view", "task-config:view", "task-config:timing"],
  },
  {
    title: "permGroup.automation",
    ids: [
      "scheduler-config:view", "scheduler-config:manage-tenant",
      "tenant-config:view", "tenant-config:manage",
    ],
  },
  {
    title: "permGroup.audit",
    ids: ["audit:view"],
  },
];

/** 補充說明 · 只寫「光看名稱不知道在做什麼」的那幾項 */
/** permission_id → i18n key（值是 key 不是文案）· ⚠️ 這裡的 key 是 `resource:action`，DB 值不可翻 */
export const PERMISSION_HINT: Record<string, string> = {
  "warroom:view": "permHint.warroom:view",
  "warroom-tasks:view": "permHint.warroom-tasks:view",
  "warroom-daily:view": "permHint.warroom-daily:view",
  "signoff:action": "permHint.signoff:action",
  "personal-report:team": "permHint.personal-report:team",
  "rag:view": "permHint.rag:view",
  "media:view": "permHint.media:view",
  "users:create-group-owner": "permHint.users:create-group-owner",
  "binding:view": "permHint.binding:view",
  "categories:view": "permHint.categories:view",
  "task-config:timing": "permHint.task-config:timing",
  "scheduler-config:manage-tenant": "permHint.scheduler-config:manage-tenant",
  "audit:view": "permHint.audit:view",
};

/**
 * 拿掉會讓整家公司「看不到東西」的權限 —— 移除前要跳確認。
 *
 * 判準不是「重要」，是**移除之後使用者會不知道發生什麼事**：
 * 沒有 warroom:view，側邊欄整區消失，而他不會聯想到是權限被關掉。
 */
export const CRITICAL_PERMISSION_IDS = new Set(["warroom:view", "warroom-tasks:view"]);
