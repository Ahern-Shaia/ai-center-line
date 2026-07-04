// 租戶設定 mock — 台灣福祉的參數設定。demo 錄影用。純顯示、不接後端。

export interface SettingItem {
  key: string;
  label: string;
  value: string;
  hint?: string;
}

export interface SettingSection {
  title: string;
  desc: string;
  items: SettingItem[];
}

export const TENANT_SETTINGS: SettingSection[] = [
  {
    title: "健康度參數",
    desc: "戰情室三環儀表的計算基準",
    items: [
      { key: "green_threshold", label: "綠燈判定閾值", value: "當日高信心比例 ≥ 80%", hint: "低於此值降為黃燈" },
      { key: "yellow_threshold", label: "黃燈判定閾值", value: "當日含低信心 tickets 或高信心比例 60-80%" },
      { key: "red_threshold", label: "紅燈判定閾值", value: "24 小時無新進線 或 已逾時未派工", hint: "會觸發告警通知" },
      { key: "overdue_hours", label: "逾時警示門檻", value: "24 小時" },
    ],
  },
  {
    title: "資料保存期限",
    desc: "各類資料的保留時長；到期後依保留策略處理",
    items: [
      { key: "raw_messages", label: "原始 LINE 訊息", value: "365 天", hint: "含照片、影片、檔案；到期軟刪" },
      { key: "tickets", label: "AI 分析結果 · tickets", value: "永久保留", hint: "已同步至 Ragic 者以 Ragic 為準" },
      { key: "conversations", label: "智慧檢索對話", value: "90 天", hint: "到期後保留 title 與稽核紀錄，內文清除" },
      { key: "audit_log", label: "稽核記錄", value: "3 年", hint: "符合企業內控與資安稽核基準" },
      { key: "media_files", label: "多模態原檔", value: "180 天", hint: "圖片、影片、文件；到期歸檔至冷儲存" },
    ],
  },
  {
    title: "AI 模型分階（依部門）",
    desc: "不同部門依訊息複雜度指派不同模型；主管可依成本 / 品質微調",
    items: [
      { key: "d1", label: "技術工程", value: "Claude Sonnet 4.6", hint: "報工日報結構化程度高" },
      { key: "d2", label: "售後服務", value: "Claude Sonnet 4.6", hint: "含車號部位判斷需高精度" },
      { key: "d3", label: "報工生產", value: "Claude Haiku 4.5", hint: "產線進度描述簡潔" },
      { key: "d4", label: "業務一部", value: "Claude Sonnet 4.6", hint: "含 OCR 手寫單處理" },
      { key: "d5", label: "人資總務", value: "Claude Haiku 4.5", hint: "指令型訊息為主" },
      { key: "d6", label: "技術研發", value: "Claude Opus 4.7", hint: "含法規對應與技術決策，需最高精度" },
    ],
  },
  {
    title: "外部整合",
    desc: "與外部系統的介接狀態",
    items: [
      { key: "line_bot", label: "LINE 官方帳號", value: "已連線", hint: "channel secret 已設定 · 6 群組已訂閱" },
      { key: "ragic", label: "Ragic ERP", value: "已連線", hint: "API endpoint: taiwanhomecare.ragic.com · Outbox 冪等寫入" },
      { key: "itri", label: "工研院知識庫", value: "已啟用", hint: "技術研發群組同步 · 契約有效期至 2027-06" },
      { key: "notification", label: "告警通知", value: "Email + LINE Notify", hint: "逾時、同步失敗、批次錯誤" },
    ],
  },
  {
    title: "隱私與去識別",
    desc: "資料保護參數；地端處理，個資不出場",
    items: [
      { key: "ner_mode", label: "去識別策略", value: "本地 NER + 規則遮罩", hint: "人名 / 電話 / 車牌 / 地址 token 化" },
      { key: "pseudo_map", label: "假名對照表", value: "僅存於您廠內", hint: "AI 分析階段完全看不到真實個資" },
      { key: "opt_out", label: "員工 opt-out 機制", value: "已啟用", hint: "個別員工可於 LINE 端 opt-out 不入分析" },
      { key: "media_redact", label: "影像自動遮罩", value: "臉部 / 車牌 / 證件", hint: "上傳即遮罩，原檔仍留存於您廠內" },
    ],
  },
];
