// 稽核記錄 mock — audit_log 事件流。demo 錄影用。
// 正式版走 audit_log 表（見 §12、R5、R11）
export type AuditAction = "簽核" | "查看" | "檢索" | "匯出" | "登入" | "變更設定" | "代簽核" | "駁回";

export interface AuditEntry {
  id: string;
  ts: string;              // ISO
  actor: string;           // display_name
  actorRole: "總經理室" | "群組負責人" | "顧問" | "AIPROOT 管理員";
  action: AuditAction;
  target: string;          // 對象描述（含 ID）
  targetDept?: string;
  outcome: "成功" | "失敗" | "已攔截";
  ip: string;
}

// 依時間倒序排列（最新在前）
export const AUDIT_LOG: AuditEntry[] = [
  { id: "A-201", ts: "2026-07-04T11:32:15", actor: "王總", actorRole: "總經理室", action: "檢索", target: "「彰化那台復康巴士 ABC-1234 升降機保養紀錄」· 命中 3 筆", targetDept: "跨部門", outcome: "成功", ip: "10.0.0.42" },
  { id: "A-200", ts: "2026-07-04T11:28:42", actor: "王總", actorRole: "總經理室", action: "查看", target: "工單 WO-2506-041", targetDept: "售後服務", outcome: "成功", ip: "10.0.0.42" },
  { id: "A-199", ts: "2026-07-04T09:42:11", actor: "宗瀚", actorRole: "群組負責人", action: "簽核", target: "T-060, T-061（2 筆）", targetDept: "技術研發", outcome: "成功", ip: "10.0.0.51" },
  { id: "A-198", ts: "2026-07-04T09:38:20", actor: "宗瀚", actorRole: "群組負責人", action: "查看", target: "技術研發 · 今日 tickets", targetDept: "技術研發", outcome: "成功", ip: "10.0.0.51" },
  { id: "A-197", ts: "2026-07-04T09:15:33", actor: "建國", actorRole: "群組負責人", action: "簽核", target: "T-030, T-031（2 筆）", targetDept: "業務一部", outcome: "成功", ip: "10.0.0.55" },
  { id: "A-196", ts: "2026-07-04T09:12:48", actor: "建國", actorRole: "群組負責人", action: "查看", target: "業務一部 · 今日 tickets", targetDept: "業務一部", outcome: "成功", ip: "10.0.0.55" },
  { id: "A-195", ts: "2026-07-04T09:05:22", actor: "王總", actorRole: "總經理室", action: "登入", target: "web · Chrome 138 macOS", outcome: "成功", ip: "10.0.0.42" },
  { id: "A-194", ts: "2026-07-04T09:03:15", actor: "宗瀚", actorRole: "群組負責人", action: "登入", target: "web · Chrome 138 Windows", outcome: "成功", ip: "10.0.0.51" },
  { id: "A-193", ts: "2026-07-04T09:00:08", actor: "建國", actorRole: "群組負責人", action: "登入", target: "web · Safari iOS 18", outcome: "成功", ip: "192.168.5.22" },
  { id: "A-192", ts: "2026-07-03T22:15:42", actor: "系統批次", actorRole: "AIPROOT 管理員", action: "變更設定", target: "夜間批次 · 完成 13 筆 tickets 抽取", targetDept: "跨部門", outcome: "成功", ip: "-" },
  { id: "A-191", ts: "2026-07-03T17:20:11", actor: "王總", actorRole: "總經理室", action: "檢索", target: "「7 月改裝日報總工時多少？」· 命中 3 筆", targetDept: "跨部門", outcome: "成功", ip: "10.0.0.42" },
  { id: "A-190", ts: "2026-07-03T16:45:33", actor: "婷婷", actorRole: "群組負責人", action: "駁回", target: "T-011「門壞了」· 低信心攔截", targetDept: "售後服務", outcome: "已攔截", ip: "10.0.0.48" },
  { id: "A-189", ts: "2026-07-03T16:32:20", actor: "婷婷", actorRole: "群組負責人", action: "查看", target: "售後服務 · 今日 tickets", targetDept: "售後服務", outcome: "成功", ip: "10.0.0.48" },
  { id: "A-188", ts: "2026-07-03T15:12:44", actor: "王總", actorRole: "總經理室", action: "匯出", target: "6 月報工日報 CSV · 142 筆", targetDept: "技術工程", outcome: "成功", ip: "10.0.0.42" },
  { id: "A-187", ts: "2026-07-03T14:45:08", actor: "阿豪", actorRole: "群組負責人", action: "簽核", target: "T-020, T-021（2 筆）", targetDept: "報工生產", outcome: "成功", ip: "10.0.0.60" },
  { id: "A-186", ts: "2026-07-03T14:32:52", actor: "阿豪", actorRole: "群組負責人", action: "查看", target: "報工生產 · 今日 tickets", targetDept: "報工生產", outcome: "成功", ip: "10.0.0.60" },
  { id: "A-185", ts: "2026-07-03T11:20:18", actor: "顧問-陳老師", actorRole: "顧問", action: "代簽核", target: "T-004 張○○ 協助試車", targetDept: "技術工程", outcome: "成功", ip: "203.204.55.78" },
  { id: "A-184", ts: "2026-07-03T11:18:44", actor: "顧問-陳老師", actorRole: "顧問", action: "查看", target: "技術工程 · 待簽核 tickets", targetDept: "技術工程", outcome: "成功", ip: "203.204.55.78" },
  { id: "A-183", ts: "2026-07-03T10:15:22", actor: "王總", actorRole: "總經理室", action: "檢索", target: "「STARIA 高頂那個標案現在誰在跟」· 命中 2 筆", targetDept: "業務一部", outcome: "成功", ip: "10.0.0.42" },
  { id: "A-182", ts: "2026-07-03T09:22:03", actor: "王總", actorRole: "總經理室", action: "登入", target: "web · Chrome 138 macOS", outcome: "成功", ip: "10.0.0.42" },
  { id: "A-181", ts: "2026-07-02T22:15:33", actor: "系統批次", actorRole: "AIPROOT 管理員", action: "變更設定", target: "夜間批次 · 完成 11 筆 tickets 抽取", targetDept: "跨部門", outcome: "成功", ip: "-" },
  { id: "A-180", ts: "2026-07-02T18:45:20", actor: "阿豪", actorRole: "群組負責人", action: "簽核", target: "T-001, T-002（2 筆）", targetDept: "技術工程", outcome: "成功", ip: "10.0.0.60" },
  { id: "A-179", ts: "2026-07-02T17:45:11", actor: "研發-家豪", actorRole: "群組負責人", action: "查看", target: "KM #0142 消防法規對應", targetDept: "技術研發", outcome: "成功", ip: "10.0.0.51" },
  { id: "A-178", ts: "2026-07-02T14:22:35", actor: "王總", actorRole: "總經理室", action: "檢索", target: "「到宅沐浴車鍋爐改裝，法規那次調整是誰確認的」· 命中 2 筆", targetDept: "技術研發", outcome: "成功", ip: "10.0.0.42" },
  { id: "A-177", ts: "2026-07-02T11:08:44", actor: "婷婷", actorRole: "群組負責人", action: "查看", target: "工單 WO-2506-041", targetDept: "售後服務", outcome: "成功", ip: "10.0.0.48" },
  { id: "A-176", ts: "2026-07-02T09:15:22", actor: "王總", actorRole: "總經理室", action: "登入", target: "web · Chrome 138 macOS", outcome: "成功", ip: "10.0.0.42" },
];
