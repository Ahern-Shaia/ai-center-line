// 後端 API client。dev 走 Vite proxy（/api → :3000）。

export interface WarroomTicket {
  ticket_id: string;
  summary: string;
  confidence: "high" | "medium" | "low" | null;
  needs_review: boolean;
  status: "待簽核" | "已簽核" | "逾時警示";
}

export interface WarroomGroup {
  department_id: string;
  name: string;
  ragic_table: string;
  health: "green" | "yellow" | "red";
  signed_off: boolean;
  today_total: number;
  high_count: number;
  has_low_pending: boolean;
  signed_by_name: string | null;
  signed_at: string | null;
  today_tickets: WarroomTicket[];
}
export interface Warroom {
  as_of: string;
  dept_count: number;
  signoff_rate: number;
  signed_depts: number;
  health_rate: number;
  green_depts: number;
  high_conf_ratio: number;
  high_num: number;
  high_den: number;
  groups: WarroomGroup[];
}
export interface PendingTicket {
  ticketId: string;
  summary: string;
  confidence: "high" | "medium" | "low" | null;
  departmentId: string;
  needsReview: boolean;
}
export interface ConfirmResult {
  confirmed: string[];
  blocked: { ticket_id: string; reason: string }[];
  skipped: string[];
}

export type Role = "aiproot_admin" | "consultant" | "tenant_admin" | "group_owner";
export interface Session {
  email: string;
  role: Role;
  tenantId: string;
  departmentId: string | null;
  exp: number;
}

const TOKEN_KEY = "acl.token";
const EMAIL_KEY = "acl.email";

let token: string | null = localStorage.getItem(TOKEN_KEY);
export const getToken = () => token;

function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

function decodeJwt(t: string): Record<string, unknown> | null {
  try {
    const [, payload] = t.split(".");
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  if (!token) return null;
  const p = decodeJwt(token);
  if (!p || typeof p !== "object") return null;
  const email = localStorage.getItem(EMAIL_KEY) ?? "";
  return {
    email,
    role: (p.role as Role) ?? "group_owner",
    tenantId: (p.tenant_id as string) ?? "",
    departmentId: (p.department_id as string | null) ?? null,
    exp: (p.exp as number) ?? 0,
  };
}

export function logout() {
  setToken(null);
  localStorage.removeItem(EMAIL_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// HTTP status → 使用者可讀中文；避免把 Nest 預設英文（Internal server error / Unauthorized）
// 直接秀給客戶。真正原因保留在 console（dev）供除錯。
function friendlyStatusMessage(status: number): string {
  if (status === 400) return "送出的資料不正確，請確認後再試";
  if (status === 401) return "尚未登入或工作階段已過期，請重新登入";
  if (status === 403) return "沒有權限執行此操作";
  if (status === 404) return "找不到對應資料";
  if (status === 409) return "資料狀態已被他人變更，請重新整理後再試";
  if (status === 422) return "輸入的資料格式有誤";
  if (status === 429) return "操作太頻繁，請稍後再試";
  if (status >= 500) return "系統目前忙碌，請稍後再試";
  return "發生錯誤，請稍後再試";
}

// 若 server 特意寫了中文訊息（非 Nest 預設英文），優先使用；否則走 mapping。
const GENERIC_SERVER_MSG = /^(internal server error|bad request|not found|forbidden|unauthorized|too many requests|unprocessable entity|conflict|payload too large)$/i;

// API base URL：
// - dev（本機）：不設 VITE_API_BASE_URL → 空字串 → `/api${path}` 走 Vite proxy 到 localhost:3000
// - prod（Render）：設 VITE_API_BASE_URL=https://ai-center-line.onrender.com → 前端直打 backend
//   （Render Static Site _redirects 對 POST 不可靠 · 直打 backend + CORS 白名單更穩）
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  let res: Response;
  const url = API_BASE ? `${API_BASE}${path}` : `/api${path}`;
  try {
    res = await fetch(url, {
      ...opts,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
    });
  } catch (e) {
    // 網路失敗（離線、DNS、CORS block、server down）
    if (import.meta.env.DEV) console.error(`[api] network failure on ${path}`, e);
    throw new ApiError(0, "無法連線到伺服器，請確認網路後再試");
  }

  if (res.status === 401 && path !== "/auth/login") {
    logout();
    throw new ApiError(401, "工作階段已過期，請重新登入");
  }

  if (!res.ok) {
    let serverMsg = "";
    try {
      const body = await res.clone().json();
      if (typeof body?.message === "string") serverMsg = body.message.trim();
      else if (Array.isArray(body?.message)) serverMsg = body.message.join("; ");
    } catch {
      // not JSON
    }
    const isGeneric = !serverMsg || GENERIC_SERVER_MSG.test(serverMsg);
    const hasChinese = /[一-龥]/.test(serverMsg);
    const friendly = !isGeneric && hasChinese ? serverMsg : friendlyStatusMessage(res.status);
    if (import.meta.env.DEV) console.error(`[api] ${path} → ${res.status}`, serverMsg || "(no body)");
    throw new ApiError(res.status, friendly);
  }
  // 2xx 但拿到非 JSON（常見於 Static Site 的 SPA fallback 抓到 API 路徑，回 index.html）
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (import.meta.env.DEV) console.error(`[api] ${path} → 2xx 但非 JSON · content-type=${contentType} · 可能是 _redirects 沒生效`);
    throw new ApiError(0, "伺服器回應格式異常，請確認前端 API 代理設定");
  }
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<void> {
  const d = await req<{ access_token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(d.access_token);
  localStorage.setItem(EMAIL_KEY, email);
}
export const getWarroom = () => req<Warroom>("/warroom");
export const getPending = () => req<{ pending: PendingTicket[] }>("/signoff");
export const confirmSignoff = (ticket_ids: string[]) =>
  req<ConfirmResult>("/signoff", { method: "POST", body: JSON.stringify({ ticket_ids }) });

// === 對話分析 · conversation-analysis pilot ===

export interface ConvoUpload {
  id: number;
  filename: string;
  tenantSlug: string;
  uploadedAt: string;
  status: "pending" | "running" | "done" | "failed";
  errorMessage: string | null;
  messageCount: number | null;
  segmentCount: number | null;
}

export interface ConvoMessage {
  id: number;
  date: string;
  time: string;
  sender: string;
  text: string;
  kind: "text" | "media" | "system";
  category: string | null;
  confidence: "high" | "medium" | "low" | null;
}

export interface ConvoDailyReport {
  date: string | null;
  reporter_name: string | null;
  reporter_code: string | null;
  line: string | null;
  machine_code: string | null;
  work_order: string | null;
  output_qty: number | null;
  defect_qty: number | null;
  work_hours: number | null;
  overtime_hours: number | null;
  issues: string | null;
  source_ids: number[];
  confidence: "high" | "medium" | "low";
}

export interface ConvoRecord {
  category: string;
  title: string;
  detail: string;
  status: "open" | "in_progress" | "resolved" | "info" | null;
  person: string | null;
  machine_code: string | null;
  work_order: string | null;
  source_ids: number[];
  confidence: "high" | "medium" | "low";
}

export interface ConvoLabel {
  targetType: "classification" | "daily_report" | "record";
  targetId: string;
  correct: boolean;
  note: string | null;
  labeledBy: string;
  labeledAt: string;
}

export interface ConvoUploadDetail {
  upload: ConvoUpload & {
    rawContent: string;
    uploadedBy: string;
    usageStats: Record<string, unknown> | null;
  };
  result: {
    messages: ConvoMessage[];
    dailyReports: ConvoDailyReport[];
    records: ConvoRecord[];
    createdAt: string;
  } | null;
  labels: ConvoLabel[];
}

export interface ConvoMetrics {
  contamination_rate: number | null;
  daily_report_accuracy: number | null;
  record_accuracy: number | null;
  label_count: number;
  by_type: {
    classification: { target_type: string; total: number; correct_count: number } | null;
    daily_report: { target_type: string; total: number; correct_count: number } | null;
    record: { target_type: string; total: number; correct_count: number } | null;
  };
}

export const listConvoUploads = () =>
  req<{ uploads: ConvoUpload[] }>("/conversation-analysis/uploads");

export const getConvoUpload = (id: number) =>
  req<ConvoUploadDetail>(`/conversation-analysis/uploads/${id}`);

export const createConvoUpload = (payload: {
  filename: string;
  rawContent: string;
  tenantSlug: "twh";
}) =>
  req<{ id: number; status: string }>("/conversation-analysis/uploads", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const createConvoLabel = (payload: {
  uploadId: number;
  targetType: "classification" | "daily_report" | "record";
  targetId: string;
  correct: boolean;
  note?: string;
}) =>
  req<{ id: number }>("/conversation-analysis/labels", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const deleteConvoLabel = (uploadId: number, targetType: string, targetId: string) =>
  req<{ status: string }>(
    `/conversation-analysis/labels?uploadId=${uploadId}&targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`,
    { method: "DELETE" },
  );

export const getConvoMetrics = (id: number) =>
  req<ConvoMetrics>(`/conversation-analysis/uploads/${id}/metrics`);
