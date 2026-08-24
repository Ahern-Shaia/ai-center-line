// 權限的「畫面呈現」設定 · docs/mockup/tenant-role-permissions.html §4
//
// 為什麼分組寫在前端而不是資料庫：
// 資料庫的 `resource` 是**資料表的分法**（audit / binding / scheduler-config），
// 而使用者認得的是**側邊欄的分法**（戰情室 / 部門與成員 / 自動化）。
// 這是呈現層的決定，放前端；後端不必知道畫面怎麼分組。
//
// 說明句（why）同理：資料庫的 description 已經是白話（0067 改寫過），
// 這裡只補「不明顯的那幾項」——「查看知識庫」不必解釋，「簽核項目」要講清楚在確認什麼。

/** 分組順序＝側邊欄順序。沒列到的權限會落到「其他」，那代表這張表該補了。 */
export const PERMISSION_GROUPS: Array<{ title: string; ids: string[] }> = [
  {
    title: "戰情室",
    ids: [
      "warroom:view", "warroom-tasks:view", "warroom-daily:view",
      "signoff:view", "signoff:action", "personal-report:team",
    ],
  },
  {
    title: "資料與知識",
    ids: ["rag:view", "media:view", "km:view", "map:view"],
  },
  {
    title: "個人",
    ids: ["personal-report:mine", "trips:mine"],
  },
  {
    title: "部門與成員",
    ids: ["departments:view", "departments:manage-tenant", "users:view", "users:create-group-owner"],
  },
  {
    title: "LINE 群組",
    ids: ["line-groups:view", "binding:view"],
  },
  {
    title: "任務設定",
    ids: ["categories:view", "task-config:view", "task-config:timing"],
  },
  {
    title: "自動化與公司設定",
    ids: [
      "scheduler-config:view", "scheduler-config:manage-tenant",
      "tenant-config:view", "tenant-config:manage",
    ],
  },
  {
    title: "稽核",
    ids: ["audit:view"],
  },
];

/** 補充說明 · 只寫「光看名稱不知道在做什麼」的那幾項 */
export const PERMISSION_HINT: Record<string, string> = {
  "warroom:view": "每天的簽核率、部門健康度那一頁",
  "warroom-tasks:view": "AI 從對話整理出來的待辦事項",
  "warroom-daily:view": "確認 AI 有沒有讀到某則訊息",
  "signoff:action": "確認 AI 整理的內容是對的",
  "personal-report:team": "只看得到自己部門的",
  "rag:view": "用問答的方式查公司的對話與文件",
  "media:view": "群組裡傳過的照片與檔案",
  "users:create-group-owner": "只能建部門主管，不能建總經理",
  "binding:view": "看得到哪些同仁還沒綁定",
  "categories:view": "AI 會把對話分成哪幾類",
  "task-config:timing": "逾期幾天算超時、什麼時候提醒",
  "scheduler-config:manage-tenant": "例如每天下午 6 點跑分析",
  "audit:view": "誰在什麼時候改了什麼",
};

/**
 * 拿掉會讓整家公司「看不到東西」的權限 —— 移除前要跳確認。
 *
 * 判準不是「重要」，是**移除之後使用者會不知道發生什麼事**：
 * 沒有 warroom:view，側邊欄整區消失，而他不會聯想到是權限被關掉。
 */
export const CRITICAL_PERMISSION_IDS = new Set(["warroom:view", "warroom-tasks:view"]);
