// English dictionary
//
// ⚠️ Keys containing Chinese (e.g. `confirmStatus.待確認`) are **database values,
//    not copy**. `tickets.confirm_status` literally stores 「待確認」.
//    Translating a key silently breaks status matching across the whole app
//    (FMEA F-1 · P0) — tickets get stuck in a state and nothing throws.
//
// ⚠️ Missing keys fall back to zh-TW, so a gap here degrades to Chinese
//    rather than printing a raw key at the customer.
//
// ⚠️ 排版：英文通常比中文長 30–50%。側欄與按鈕的字要**刻意壓短**
//    （「任務看板」4 字 → "Tasks" 而不是 "Task Board"），
//    否則中文版看起來好好的，切到英文就爆版（FMEA F-3 · P0）。

export default {
  "locale.label": "Language",

  // ── Sidebar · deliberately terse: the rail width is fixed ─────
  "navGroup.mine": "Mine",
  "navGroup.ops": "Operations",
  "navGroup.settings": "Settings",
  "navGroup.platform": "Platform",
  "nav.myDailyReport": "My report",
  "nav.myTrips": "My trips",
  "nav.taskBoard": "Tasks",
  "nav.warroom": "Overview",
  "nav.dailyLog": "Group log",
  "nav.teamReport": "Dept report",
  "nav.media": "Files",
  "nav.depts": "Depts & people",
  "nav.channels": "LINE groups",
  "nav.taskConfig": "Task settings",
  "nav.schedulerConfig": "Schedule",
  "nav.rolePermissions": "Permissions",
  "nav.audit": "Audit log",
  "nav.tenantMgmt": "Tenants",
  "nav.systemHealth": "Health",
  "nav.convoList": "Analyses",
  "nav.convoUpload": "Upload",
  "nav.llmSettings": "LLM settings",
  "nav.lineBots": "LINE bots",
  "nav.mapConfig": "Map & mileage",
  "nav.notifyConfig": "Notifications",
  "nav.masterData": "Data sources",
  "nav.rolesMgmt": "Permissions",
  "nav.rag": "Search",
  "nav.km": "Knowledge base",

  // ── Shell (user menu / pages not in the sidebar) ──────────
  "nav.comingSoon": "\u201c{name}\u201d is planned for a later release",
  "app.name": "aiproot War Room",
  "menu.changeName": "Change display name",
  "menu.changePassword": "Change password",
  "menu.switchTenant": "Switch tenant",
  "menu.logout": "Sign out",
  "page.onboarding": "How it works",
  "page.permissionGuide": "Permission guide",
  "page.map": "Customer map",
  "page.convoDetail": "Analysis detail",
  "page.convoInsights": "Extraction accuracy",

  // Three separate axes, three separate words — see shared/confirmStatusLabel.ts.
  // 「核對」means "verify what the AI wrote", NOT "the work is done".
  "confirmStatus.待確認": "To triage",
  "confirmStatus.待簽核": "To verify",
  "confirmStatus.已簽核": "Verified",
  "confirmStatus.逾時警示": "Overdue",
  "confirmStatus.已忽略": "Dismissed",
  "confirmStatus.存查": "Archived",

  // ⚠️ `resolved` is deliberately NOT "Done" — it is what the AI *read* from the
  //    conversation (an inference), whereas completion is what the owner *reported*
  //    (a commitment, stored in work_outcome). Same word for both produces
  //    "Done but not yet confirmed done" on the board.
  "recordStatus.open": "Open",
  "recordStatus.in_progress": "In progress",
  "recordStatus.resolved": "AI read as resolved",
  "recordStatus.info": "Announcement / info",

  "role.aiproot_admin": "AIPROOT admin",
  "role.consultant": "Consultant",
  "role.tenant_admin": "Executive office",
  "role.group_owner": "Department manager",
  "role.assistant": "Assistant",
  "role.employee": "Employee",

  "category.daily_report": "Daily report",
  "category.maintenance": "Maintenance",
  "category.attendance": "Attendance",
  "category.rnd": "R&D",
  "category.procurement": "Procurement",
  "category.sales": "Sales",
  "category.it_support": "IT support",
  "category.meeting": "Meeting notes",
  "category.facility_management": "Facilities",
  "category.chitchat": "Chitchat",
  "category.unknown": "Other ({name})",
} satisfies Record<string, string>;
