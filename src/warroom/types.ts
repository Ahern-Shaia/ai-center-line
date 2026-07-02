// 資料模型對應合夥人 CTO 說明書 v0.6 §4.5 tickets 通用事件表（節錄戰情室渲染所需欄位）。
// 戰情室畫面每個數字皆由此資料層計算，不硬編——符合委員鐵律「每個數字可回溯至來源表」。

export type Confidence = "high" | "medium" | "low";
export type ConfirmStatus = "待簽核" | "已簽核" | "逾時警示";

export interface Department {
  department_id: string;
  name: string;
  ragic_table: string;
  line_group_id: string;
  last_activity: string; // ISO；用於健康度燈號判定
}

export interface Ticket {
  ticket_id: string;
  department_id: string;
  category: string;
  summary: string;
  confidence: Confidence | null; // null = 未標信心度（不計入高信心比例分母）
  confirm_status: ConfirmStatus;
  confirmed_by: string | null; // 已假名化
  confirmed_at: string | null;
  needs_review: boolean; // 低信心即時攔截
  message_count: number;
  linked_ref: string | null; // 車號 / 工單號 等
  created_at: string;
}

// 另存的月度/服務計數（來自 CRM_service_tickets / RAG 索引 / pending_review 等不同表）
export interface StoredMetrics {
  monthly_service_tickets: number; // CRM_service_tickets 當月
  km_documents: number; // 多模態 RAG 索引文件累積
  pending_review: number; // pending_review 未覆核
  as_of_date: string; // 資料基準日
}

// 示範用（非 pipeline 資料）：RAG 對話腳本、多模態素材、地圖點位。委員文件明載對話為示範腳本。
export interface ChatTurn { role: "you" | "ai"; text: string; cite?: string; itri?: boolean; }
export interface Asset { kind: "img" | "vid" | "pdf" | "csv"; name: string; group: string; }
export interface GeoPoint { x: number; y: number; big?: boolean; }
export interface Illustrative {
  chat: ChatTurn[];
  assets: Asset[];
  geo: GeoPoint[];
  geo_stats: { points: number; cities: number; hq: string };
}

export interface WarRoomData {
  tenant_name: string;
  departments: Department[];
  tickets: Ticket[];
  metrics: StoredMetrics;
  illustrative?: Illustrative;
}

// aiproot_admin 跨租戶總覽——刻意只含聚合摘要，不含任何 tickets 內容（租戶隔離）
export interface SubsidyStage { status: string; n: number | null; }
export interface SubsidyMeasure { measure: string; desc: string; stages: SubsidyStage[]; }
export interface TenantRow {
  name: string;
  industry: string;
  onboard_status: "正式上線" | "測試中" | "洽談中";
  subsidy: string;
  subsidy_tone: "pine" | "warn" | "ghost";
  is_home_care?: boolean; // 台灣福祉本尊：健康度燈號改由 tickets aggregate 帶入
  health: (Health | "idle")[];
  health_label: string;
  seats_used: number | null;
  seats_total: number | null;
  last_activity: string;
}
export interface AiprootData {
  as_of: string;
  counts: { online: number; testing: number; talking: number; subsidy_active: number };
  total_pipeline: number;
  funnel: SubsidyMeasure[];
  tenants: TenantRow[];
}

// aggregate 產物——三環形儀表 + 六群組健康度，供渲染層直接綁定
export type Health = "green" | "yellow" | "red";

export interface GroupStatus {
  department: Department;
  health: Health;
  signed_off: boolean;
  today_total: number;
  high_count: number;
  has_low_pending: boolean;
  active_within_24h: boolean;
}

export interface Aggregate {
  as_of: string;
  signoff_rate: number; // 已簽核群組 ÷ 6
  signed_groups: number;
  health_rate: number; // 綠燈群組 ÷ 6
  green_groups: number;
  high_conf_ratio: number; // high 筆數 ÷ 當日已標信心度總數
  high_conf_num: number;
  high_conf_den: number;
  groups: GroupStatus[];
  metrics: StoredMetrics;
}
