// 部門/成員 mock — 6 部門詳細配置 + 各部門成員列表。demo 錄影用。
export interface DeptRow {
  code: string;
  name: string;
  lineGroupId: string;
  extractionSchema: string;
  recordCategory: string;  // 對應記錄類型（客戶可懂的業務語彙，非內部 schema 名）
  ownerName: string;
  memberCount: number;
  active: boolean;
}

export interface Member {
  name: string;
  role: "群組負責人" | "組員" | "跨群支援";
  lineHandle: string;
  dept: string;
  joinedAt: string;
  lastActiveAt: string;
}

export const DEPT_ROWS: DeptRow[] = [
  { code: "D1", name: "技術工程", lineGroupId: "Cc9f8b2a3xxxxxx", extractionSchema: "報工日報 · 每日結構化", recordCategory: "報工日報記錄", ownerName: "組長-阿豪", memberCount: 8, active: true },
  { code: "D2", name: "售後服務", lineGroupId: "Cd3e6f1c8xxxxxx", extractionSchema: "維修工單 · 車號部位症狀處置", recordCategory: "客服工單記錄", ownerName: "客服-婷婷", memberCount: 5, active: true },
  { code: "D3", name: "報工生產", lineGroupId: "Ca7b2e9d4xxxxxx", extractionSchema: "產線進度 · 車體/工序/影像", recordCategory: "生產進度記錄", ownerName: "組長-美惠", memberCount: 7, active: true },
  { code: "D4", name: "業務一部", lineGroupId: "Cf1d5c8a2xxxxxx", extractionSchema: "客戶意向 · OCR/採購單", recordCategory: "客戶機會記錄", ownerName: "業務-建國", memberCount: 4, active: true },
  { code: "D5", name: "人資總務", lineGroupId: "Cb4e7f9c1xxxxxx", extractionSchema: "設施 · 請假 · 派工", recordCategory: "人資設施記錄", ownerName: "總務-秀敏", memberCount: 3, active: true },
  { code: "D6", name: "技術研發", lineGroupId: "Ce8a1b6d5xxxxxx", extractionSchema: "技術決策 · 法規對應 · 選型", recordCategory: "技術知識庫", ownerName: "研發-家豪", memberCount: 4, active: true },
];

export const MEMBERS: Member[] = [
  // D1 技術工程
  { name: "組長-阿豪", role: "群組負責人", lineHandle: "@ahao_lead", dept: "D1", joinedAt: "2024-03-15", lastActiveAt: "2026-07-04T09:12:00" },
  { name: "阿源", role: "組員", lineHandle: "@ayuan_tech", dept: "D1", joinedAt: "2024-05-20", lastActiveAt: "2026-07-04T08:31:00" },
  { name: "阿賢", role: "組員", lineHandle: "@axian_tech", dept: "D1", joinedAt: "2024-06-10", lastActiveAt: "2026-07-03T18:45:00" },
  { name: "小凱", role: "組員", lineHandle: "@xiaokai_tech", dept: "D1", joinedAt: "2024-08-01", lastActiveAt: "2026-07-04T10:22:00" },
  { name: "阿仁", role: "組員", lineHandle: "@aren_tech", dept: "D1", joinedAt: "2024-09-12", lastActiveAt: "2026-07-03T19:02:00" },
  { name: "採購-淑惠", role: "跨群支援", lineHandle: "@shuhui_pur", dept: "D1", joinedAt: "2024-03-15", lastActiveAt: "2026-07-04T09:50:00" },
  { name: "美惠", role: "跨群支援", lineHandle: "@meihui_prod", dept: "D1", joinedAt: "2024-04-08", lastActiveAt: "2026-07-04T08:31:00" },
  { name: "業務-建國", role: "跨群支援", lineHandle: "@jianguo_sales", dept: "D1", joinedAt: "2024-06-01", lastActiveAt: "2026-07-04T11:05:00" },
  // D2 售後服務
  { name: "客服-婷婷", role: "群組負責人", lineHandle: "@tingting_svc", dept: "D2", joinedAt: "2024-02-10", lastActiveAt: "2026-07-04T15:15:00" },
  { name: "維修-建華", role: "組員", lineHandle: "@jianhua_svc", dept: "D2", joinedAt: "2024-04-20", lastActiveAt: "2026-07-04T14:22:00" },
  { name: "維修-志偉", role: "組員", lineHandle: "@zhiwei_svc", dept: "D2", joinedAt: "2024-07-15", lastActiveAt: "2026-07-03T17:30:00" },
  { name: "維修-明宏", role: "組員", lineHandle: "@minghong_svc", dept: "D2", joinedAt: "2024-10-01", lastActiveAt: "2026-07-04T13:08:00" },
  { name: "阿源", role: "跨群支援", lineHandle: "@ayuan_tech", dept: "D2", joinedAt: "2024-05-20", lastActiveAt: "2026-07-04T08:31:00" },
  // D3 報工生產
  { name: "組長-美惠", role: "群組負責人", lineHandle: "@meihui_prod", dept: "D3", joinedAt: "2024-04-08", lastActiveAt: "2026-07-04T08:31:00" },
  { name: "阿義", role: "組員", lineHandle: "@ayi_prod", dept: "D3", joinedAt: "2024-05-15", lastActiveAt: "2026-07-04T14:05:00" },
  { name: "阿明", role: "組員", lineHandle: "@aming_prod", dept: "D3", joinedAt: "2024-06-20", lastActiveAt: "2026-07-04T09:40:00" },
  { name: "小華", role: "組員", lineHandle: "@xiaohua_prod", dept: "D3", joinedAt: "2024-08-10", lastActiveAt: "2026-07-03T18:00:00" },
  { name: "阿吉", role: "組員", lineHandle: "@aji_prod", dept: "D3", joinedAt: "2024-09-05", lastActiveAt: "2026-07-04T10:15:00" },
  { name: "美玲", role: "組員", lineHandle: "@meiling_qc", dept: "D3", joinedAt: "2024-11-01", lastActiveAt: "2026-07-04T12:10:00" },
  { name: "阿宏", role: "組員", lineHandle: "@ahong_prod", dept: "D3", joinedAt: "2025-01-15", lastActiveAt: "2026-07-03T21:15:00" },
  // D4 業務一部
  { name: "業務-建國", role: "群組負責人", lineHandle: "@jianguo_sales", dept: "D4", joinedAt: "2024-06-01", lastActiveAt: "2026-07-04T11:05:00" },
  { name: "業務-淑芬", role: "組員", lineHandle: "@shufen_sales", dept: "D4", joinedAt: "2024-08-15", lastActiveAt: "2026-07-04T10:30:00" },
  { name: "業務-俊傑", role: "組員", lineHandle: "@junjie_sales", dept: "D4", joinedAt: "2024-11-01", lastActiveAt: "2026-07-04T09:15:00" },
  { name: "採購-淑惠", role: "跨群支援", lineHandle: "@shuhui_pur", dept: "D4", joinedAt: "2024-03-15", lastActiveAt: "2026-07-04T09:50:00" },
  // D5 人資總務
  { name: "總務-秀敏", role: "群組負責人", lineHandle: "@xiumin_hr", dept: "D5", joinedAt: "2024-01-15", lastActiveAt: "2026-07-04T09:45:00" },
  { name: "人資-淑玲", role: "組員", lineHandle: "@shuling_hr", dept: "D5", joinedAt: "2024-03-01", lastActiveAt: "2026-07-04T10:20:00" },
  { name: "總務-志明", role: "組員", lineHandle: "@zhiming_hr", dept: "D5", joinedAt: "2024-05-20", lastActiveAt: "2026-07-03T17:00:00" },
  // D6 技術研發
  { name: "研發-家豪", role: "群組負責人", lineHandle: "@jiahao_rd", dept: "D6", joinedAt: "2024-02-01", lastActiveAt: "2026-07-04T11:30:00" },
  { name: "研發-黃○○", role: "組員", lineHandle: "@zonghan_rd", dept: "D6", joinedAt: "2024-04-15", lastActiveAt: "2026-07-04T09:42:00" },
  { name: "研發-育誠", role: "組員", lineHandle: "@yucheng_rd", dept: "D6", joinedAt: "2024-07-10", lastActiveAt: "2026-07-04T10:15:00" },
  { name: "研發-佩君", role: "組員", lineHandle: "@peijun_rd", dept: "D6", joinedAt: "2024-09-01", lastActiveAt: "2026-07-03T18:22:00" },
];
