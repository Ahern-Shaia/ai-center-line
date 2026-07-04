// 素材看板 mock — 跨群組多模態檔案。demo 錄影用；正式版走 media_files 表（見 rag-conversations.md §4.1）
export type MediaKind = "image" | "video" | "document" | "spreadsheet" | "audio";

export interface MediaFile {
  id: string;
  name: string;
  kind: MediaKind;
  ext: string;         // png / mp4 / pdf / xlsx / m4a
  sizeKB: number;
  dept: string;        // 來源部門
  uploader: string;    // 來源 LINE 暱稱
  uploadedAt: string;  // ISO
  meta?: string;       // 附加描述（尺寸 / 頁數 / 時長 / rows）
}

export const MEDIA_FILES: MediaFile[] = [
  { id: "F001", name: "升降機結構圖_v3.png", kind: "image", ext: "png", sizeKB: 2431, dept: "技術研發", uploader: "研發-家豪", uploadedAt: "2026-07-02T15:22:00", meta: "1200×800 · 側視圖" },
  { id: "F002", name: "7月改裝日報統計.xlsx", kind: "spreadsheet", ext: "xlsx", sizeKB: 42, dept: "技術工程", uploader: "系統自動彙整", uploadedAt: "2026-07-04T00:15:00", meta: "8 rows · 6 欄 · 3 工作表" },
  { id: "F003", name: "現場異音檢測.mp4", kind: "video", ext: "mp4", sizeKB: 18240, dept: "售後服務", uploader: "客服-婷婷", uploadedAt: "2026-07-03T14:12:00", meta: "01:23 · 1080p" },
  { id: "F004", name: "產發署標案合約_已用印.pdf", kind: "document", ext: "pdf", sizeKB: 1284, dept: "業務一部", uploader: "業務-建國", uploadedAt: "2026-07-01T10:45:00", meta: "12 頁" },
  { id: "F005", name: "CADDY_MAXI_扶手鎖點_圖紙.png", kind: "image", ext: "png", sizeKB: 1867, dept: "技術研發", uploader: "研發-家豪", uploadedAt: "2026-07-02T10:32:00", meta: "800×600" },
  { id: "F006", name: "沐浴車熱水模組_試運轉.mp4", kind: "video", ext: "mp4", sizeKB: 14520, dept: "技術工程", uploader: "阿賢", uploadedAt: "2026-07-03T10:20:00", meta: "00:45 · 720p" },
  { id: "F007", name: "客戶手寫採購單_OCR前.jpg", kind: "image", ext: "jpg", sizeKB: 892, dept: "業務一部", uploader: "業務-建國", uploadedAt: "2026-07-03T14:10:00", meta: "3024×4032" },
  { id: "F008", name: "6月工時彙整.csv", kind: "spreadsheet", ext: "csv", sizeKB: 18, dept: "技術工程", uploader: "系統自動彙整", uploadedAt: "2026-07-01T00:15:00", meta: "142 rows · 6 欄" },
  { id: "F009", name: "B線產能語音回報.m4a", kind: "audio", ext: "m4a", sizeKB: 342, dept: "報工生產", uploader: "阿義", uploadedAt: "2026-07-03T14:05:00", meta: "00:18" },
  { id: "F010", name: "STARIA報價單_v2.pdf", kind: "document", ext: "pdf", sizeKB: 421, dept: "業務一部", uploader: "業務-建國", uploadedAt: "2026-07-02T15:30:00", meta: "4 頁" },
  { id: "F011", name: "消防法規第11條摘要.pdf", kind: "document", ext: "pdf", sizeKB: 156, dept: "技術研發", uploader: "研發-家豪", uploadedAt: "2026-07-02T17:35:00", meta: "2 頁" },
  { id: "F012", name: "示範車號A交車前檢查表.pdf", kind: "document", ext: "pdf", sizeKB: 245, dept: "售後服務", uploader: "阿仁", uploadedAt: "2026-07-03T11:08:00", meta: "1 頁" },
  { id: "F013", name: "鋼索斷裂現場.jpg", kind: "image", ext: "jpg", sizeKB: 1245, dept: "售後服務", uploader: "阿源", uploadedAt: "2026-07-02T09:35:00", meta: "3024×4032" },
  { id: "F014", name: "改裝日報_07-02.pdf", kind: "document", ext: "pdf", sizeKB: 98, dept: "技術工程", uploader: "組長-阿豪", uploadedAt: "2026-07-02T19:30:00", meta: "3 頁" },
  { id: "F015", name: "B案復康巴士塗裝進度.mp4", kind: "video", ext: "mp4", sizeKB: 22400, dept: "報工生產", uploader: "美惠", uploadedAt: "2026-07-03T08:32:00", meta: "00:35 · 1080p" },
  { id: "F016", name: "升降機馬達選型比較.xlsx", kind: "spreadsheet", ext: "xlsx", sizeKB: 65, dept: "技術研發", uploader: "研發-家豪", uploadedAt: "2026-07-03T19:12:00", meta: "3 rows · 8 欄" },
];
