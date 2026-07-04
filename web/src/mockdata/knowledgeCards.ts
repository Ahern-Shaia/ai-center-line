// 知識庫 mock — AI 從 LINE 對話抽取的知識卡片。demo 錄影用。
// 正式版走 knowledge_cards 表（見 rag-conversations.md §4.1）
export interface KnowledgeCard {
  id: string;         // KM #0142
  title: string;
  body: string;       // 卡片內文摘要
  tags: string[];
  dept: string;
  updatedAt: string;
  sourceCount: number; // 有幾則原始 LINE 訊息參與抽取
  indexedRag: boolean;
}

export const KM_CARDS: KnowledgeCard[] = [
  {
    id: "KM #0142",
    title: "消防法規對應 · 高壓閥位置調整",
    body: "因應消防安全法規第 11 條，到宅沐浴車高壓閥位置需向上調整 15 公分，以維持標準出水壓力。本批車輛全數需調整；已同步至工研院資料庫。",
    tags: ["消防法規", "沐浴車", "高壓閥"],
    dept: "技術研發",
    updatedAt: "2026-07-02T17:30:00",
    sourceCount: 3,
    indexedRag: true,
  },
  {
    id: "KM #0089",
    title: "升降機保養規範 v2",
    body: "液壓油：每 3 個月或 5000 km 檢查；鋼索張力：每 3 個月檢查；異音、卡頓：立即停用回廠。附標準工序流程與檢查表。",
    tags: ["升降機", "保養", "鋼索", "液壓油"],
    dept: "技術研發",
    updatedAt: "2026-06-28T14:15:00",
    sourceCount: 7,
    indexedRag: true,
  },
  {
    id: "KM #0089-3",
    title: "固定帶安全規範（扶手變動聯動）",
    body: "扶手位置變動 > 2cm 時，固定帶錨點必須同步調整並經強度複驗；標準複驗流程見附錄 A。",
    tags: ["固定帶", "扶手", "安全"],
    dept: "技術研發",
    updatedAt: "2026-07-02T11:30:00",
    sourceCount: 2,
    indexedRag: true,
  },
  {
    id: "KM #0156",
    title: "STARIA 高頂改裝流程 SOP",
    body: "STARIA 高頂復康巴士標準改裝順序：車體加強→升降機安裝→內裝隔板→電路整合→試車。含每階段耗時與主要工班配置。",
    tags: ["STARIA", "改裝", "SOP", "復康巴士"],
    dept: "技術工程",
    updatedAt: "2026-06-30T16:22:00",
    sourceCount: 12,
    indexedRag: true,
  },
  {
    id: "KM #0138",
    title: "熱水模組配管常見錯誤 · 案例集",
    body: "沐浴車熱水模組配管的 5 個常見錯誤：（1）試壓不足 →（2）保溫層破損 →（3）閥門定位偏差 →（4）電熱片接觸不良 →（5）出水溫度不穩。附排查決策樹。",
    tags: ["熱水模組", "配管", "沐浴車", "排查"],
    dept: "技術工程",
    updatedAt: "2026-06-25T09:44:00",
    sourceCount: 5,
    indexedRag: true,
  },
  {
    id: "KM #0201",
    title: "CADDY MAXI 扶手鎖點高度規範",
    body: "CADDY MAXI 扶手鎖點原廠高度 82cm；客戶調整 ±3cm 需同步下移錨點；> 5cm 需通報研發複驗。",
    tags: ["CADDY MAXI", "扶手", "鎖點"],
    dept: "技術研發",
    updatedAt: "2026-07-02T11:30:00",
    sourceCount: 2,
    indexedRag: true,
  },
  {
    id: "KM #0115",
    title: "採購標準鋼索規格與供應商",
    body: "升降機用標準鋼索：直徑 6mm 鍍鋅、抗拉強度 1770 MPa、原廠供應交期 2 天。緊急備料量：3 條。",
    tags: ["採購", "鋼索", "供應商"],
    dept: "技術研發",
    updatedAt: "2026-06-18T10:15:00",
    sourceCount: 4,
    indexedRag: true,
  },
  {
    id: "KM #0180",
    title: "現場異音檢測流程",
    body: "客戶回報「異音」時，依序檢查：（1）升降平台導軌 →（2）鋼索繞線 →（3）液壓油雜質 →（4）馬達軸承。錄音檔傳回廠比對聲紋資料庫。",
    tags: ["異音", "現場檢測", "排查"],
    dept: "售後服務",
    updatedAt: "2026-06-22T14:30:00",
    sourceCount: 3,
    indexedRag: true,
  },
  {
    id: "KM #0092",
    title: "報工日報結構化格式",
    body: "改裝群報工日報標準格式：日期＋姓名＋車號＋任務描述＋工時。工時填「大概」或漏填會被 AI 標中信心，需人工複核。",
    tags: ["報工", "日報", "工時", "格式"],
    dept: "技術工程",
    updatedAt: "2026-06-15T18:00:00",
    sourceCount: 8,
    indexedRag: true,
  },
  {
    id: "KM #0210",
    title: "低信心 ticket 常見補件方向",
    body: "AI 標低信心的 ticket 五大類：（1）車號未指定 →（2）部位描述含糊 →（3）症狀未量化 →（4）工時填「大概」→（5）跨群組上下文不足。附各類補件範例。",
    tags: ["AI", "低信心", "補件", "SOP"],
    dept: "售後服務",
    updatedAt: "2026-07-01T09:20:00",
    sourceCount: 6,
    indexedRag: true,
  },
  {
    id: "KM #0224",
    title: "升降機馬達選型（大扭力款規格）",
    body: "高頂車體建議使用大扭力款升降機馬達。原廠討論結論待補：具體型號、扭力值、安裝介面。",
    tags: ["升降機", "馬達", "選型"],
    dept: "技術研發",
    updatedAt: "2026-07-03T19:12:00",
    sourceCount: 1,
    indexedRag: false,
  },
  {
    id: "KM #0067",
    title: "客戶溝通話術（延遲交車）",
    body: "遇到延遲交車情況，統一話術：說明延遲原因（改裝進度／零件到貨／檢驗）→ 承諾新交車日 → 附行程進度可查。",
    tags: ["客戶溝通", "話術", "交車"],
    dept: "業務一部",
    updatedAt: "2026-05-12T11:30:00",
    sourceCount: 15,
    indexedRag: true,
  },
];
