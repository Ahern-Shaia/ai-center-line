// 繁體中文字典（基準語言）
//
// ⚠️⚠️ **key 裡的中文是 DB 值，不是文案** —— 例如 `confirmStatus.待確認`。
//    `tickets.confirm_status` 存的就是「待確認」這幾個字（見 shared/confirmStatusLabel.ts）。
//    **把 key 翻成英文，全站狀態比對會靜默失效**（FMEA F-1 · P0）：
//    任務會永遠卡在某個狀態，而且不報錯。
//    → `i18n-guard.test.ts` 釘住這件事。
//
// ⚠️ 這份是**基準** —— en.ts 缺 key 時 t() 會 fallback 回這裡。
//    所以中文字典缺 key 才是真的漏，英文缺 key 只是還沒翻。

export default {
  // ── 語言切換 ────────────────────────────────────────────────
  "locale.label": "顯示語言",

  // ── 側欄（分組＋頁面）· key 由 Shell.tsx 的 NAV 使用 ──────────
  "navGroup.mine": "我的",
  "navGroup.ops": "營運",
  "navGroup.settings": "設定",
  "navGroup.platform": "平台",
  "nav.myDailyReport": "我的日報",
  "nav.myTrips": "我的行程",
  "nav.taskBoard": "任務看板",
  "nav.warroom": "總覽儀表",
  "nav.dailyLog": "群組日誌",
  "nav.teamReport": "部門日報",
  "nav.media": "素材",
  "nav.depts": "部門 / 成員",
  "nav.channels": "LINE 群組",
  "nav.taskConfig": "任務設定",
  "nav.schedulerConfig": "分析排程",
  "nav.rolePermissions": "權限管理",
  "nav.audit": "稽核記錄",
  "nav.tenantMgmt": "租戶管理",
  "nav.systemHealth": "系統健康",
  "nav.convoList": "分析列表",
  "nav.convoUpload": "上傳新對話",
  "nav.llmSettings": "語言模型設定",
  "nav.lineBots": "LINE 機器人",
  "nav.mapConfig": "地圖里程設定",
  "nav.notifyConfig": "通知設定",
  "nav.masterData": "資料來源",
  "nav.rolesMgmt": "權限管理",
  "nav.rag": "智慧檢索",
  "nav.km": "知識庫",

  // ── 外殼（使用者選單／非側欄頁面）────────────────────────
  "nav.comingSoon": "「{name}」規劃於後續版本推出",
  "app.name": "aiproot 戰情室",
  "menu.changeName": "變更顯示名稱",
  "menu.changePassword": "變更密碼",
  "menu.switchTenant": "切換租戶",
  "menu.logout": "登出",
  "page.onboarding": "運作原理",
  "page.permissionGuide": "權限設定教學",
  "page.map": "客戶地圖",
  "page.convoDetail": "分析詳情",
  "page.convoInsights": "抽取準確率",

  // ── 任務分區（軸2：AI 寫的內容對不對）───────────────────────
  // 三條軸各用不同的詞，理由見 shared/confirmStatusLabel.ts 檔頭
  "confirmStatus.待確認": "待判定",
  "confirmStatus.待簽核": "待核對",
  "confirmStatus.已簽核": "已核對",
  "confirmStatus.逾時警示": "逾時警示",
  "confirmStatus.已忽略": "已忽略",
  "confirmStatus.存查": "存查",

  // ── AI 抽取的記錄狀態 ───────────────────────────────────────
  // ⚠️ resolved 刻意不叫「已完成」：那是 AI 讀到的推論，
  //    而「完成」是本人回報的承諾（存在 work_outcome）
  "recordStatus.open": "待處理",
  "recordStatus.in_progress": "處理中",
  "recordStatus.resolved": "AI 判讀已解決",
  "recordStatus.info": "公告／資訊",

  // ── 角色 ───────────────────────────────────────────────────
  "role.aiproot_admin": "AIPROOT 管理員",
  "role.consultant": "顧問",
  "role.tenant_admin": "總經理室",
  "role.group_owner": "部門主管",
  "role.assistant": "助理",
  "role.employee": "員工",

  // ── AI 分類 ────────────────────────────────────────────────
  "category.daily_report": "報工日報",
  "category.maintenance": "維保異常",
  "category.attendance": "出勤異動",
  "category.rnd": "研發討論",
  "category.procurement": "採購",
  "category.sales": "業務",
  "category.it_support": "資訊支援",
  "category.meeting": "會議記錄",
  "category.facility_management": "廠區設施",
  "category.chitchat": "閒聊",
  /** 未知分類的殼 —— AI 造的英文 slug 不可直接印給客戶看 */
  "category.unknown": "其他（{name}）",
} satisfies Record<string, string>;
