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
  mustChangePassword: boolean;
  passwordExpiresAt: string | null;
}

const TOKEN_KEY = "acl.token";
const EMAIL_KEY = "acl.email";
const MUST_CHANGE_KEY = "acl.must_change";
const EXPIRES_AT_KEY = "acl.password_expires";

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
    mustChangePassword: localStorage.getItem(MUST_CHANGE_KEY) === "1",
    passwordExpiresAt: localStorage.getItem(EXPIRES_AT_KEY),
  };
}

export function clearMustChange() {
  localStorage.removeItem(MUST_CHANGE_KEY);
}

export function logout() {
  setToken(null);
  localStorage.removeItem(EMAIL_KEY);
  localStorage.removeItem(MUST_CHANGE_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
  localStorage.removeItem("acl.perms");
  localStorage.removeItem("acl.perms_ts");
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
  // Fastify JSON parser 對 empty body + content-type: application/json 400
  // → 只在真的有 body 時才送 content-type
  const hasBody = opts.body != null;
  try {
    res = await fetch(url, {
      ...opts,
      headers: {
        ...(hasBody ? { "content-type": "application/json" } : {}),
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

export async function login(email: string, password: string): Promise<{ mustChange: boolean }> {
  const d = await req<{
    access_token: string;
    must_change_password: boolean;
    password_expires_at: string | null;
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(d.access_token);
  localStorage.setItem(EMAIL_KEY, email);
  if (d.must_change_password) localStorage.setItem(MUST_CHANGE_KEY, "1");
  else localStorage.removeItem(MUST_CHANGE_KEY);
  if (d.password_expires_at) localStorage.setItem(EXPIRES_AT_KEY, d.password_expires_at);
  else localStorage.removeItem(EXPIRES_AT_KEY);
  return { mustChange: d.must_change_password };
}
export const getWarroom = () => req<Warroom>("/warroom");
export const getPending = () => req<{ pending: PendingTicket[] }>("/signoff");
export const confirmSignoff = (ticket_ids: string[]) =>
  req<ConfirmResult>("/signoff", { method: "POST", body: JSON.stringify({ ticket_ids }) });

// === Warroom Task Board · WTB-M3 ===

export interface WarroomKanbanTicket {
  ticketId: string;
  category: string | null;
  categoryId: string | null;
  summary: string;
  confidence: "high" | "medium" | "low" | null;
  confirmStatus: "待簽核" | "已簽核" | "逾時警示";
  assigneeDisplayName: string | null;
  dueAt: string | null;
  sourceUploadId: number | null;
  sourceRecordIndex: number | null;
  createdAt: string;
  departmentId: string;
  departmentName: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
}

export interface WarroomTaskBoard {
  kanban: {
    pending: WarroomKanbanTicket[];
    signed: WarroomKanbanTicket[];
    overdue: WarroomKanbanTicket[];
  };
  counts: { pending: number; signed: number; overdue: number };
}

export interface WarroomDailyReport {
  uploadId: number;
  groupId: string;
  groupName: string | null;
  departmentName: string | null;
  batchDate: string;
  dailyReports: Array<Record<string, unknown>>;
  status: string;
  uploadedAt: string;
}

export interface WarroomDailyDays {
  days: Array<{ batchDate: string; uploads: WarroomDailyReport[] }>;
}

export const getWarroomTasks = (opts: { includeSigned?: boolean } = {}) => {
  const q = opts.includeSigned === false ? "?signed=false" : "";
  return req<WarroomTaskBoard>(`/warroom/tasks${q}`);
};

export const getWarroomDailyReports = (opts: { from?: string; to?: string } = {}) => {
  const p = new URLSearchParams();
  if (opts.from) p.set("from", opts.from);
  if (opts.to) p.set("to", opts.to);
  const q = p.toString();
  return req<WarroomDailyDays>(`/warroom/daily-reports${q ? `?${q}` : ""}`);
};

// === Category Registry · WTB-M5 ===

export interface CategoryRegistryItem {
  categoryId: string;
  tenantId: string;
  categoryName: string;
  categorySlug: string;
  description: string | null;
  usageCount: number;
  firstSeenAt: string;
  lastUsedAt: string;
  createdBy: string | null;
  status: "active" | "archived" | "pending_review";
}

export const listCategories = (tenantId: string, status: "active" | "all" = "all") =>
  req<{ categories: CategoryRegistryItem[] }>(`/categories?tenantId=${tenantId}&status=${status}`);

export const renameCategory = (categoryId: string, name: string) =>
  req<{ success: boolean }>(`/categories/${categoryId}/rename`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const archiveCategory = (categoryId: string) =>
  req<{ success: boolean }>(`/categories/${categoryId}/archive`, { method: "POST" });

// === Personal Daily Report · PDR-M4 ===

export interface PersonalDailyReportItem {
  time?: string;
  title: string;
  detail?: string;
  followup?: string;
}

export interface PersonalDailyReportRow {
  reportId: string;
  tenantId: string;
  userId: string;
  reportDate: string;
  uploadId: number | null;
  aiItems: PersonalDailyReportItem[];
  finalItems: PersonalDailyReportItem[] | null;
  messageCount: number;
  status: "draft" | "confirmed" | "sent" | "empty" | "failed";
  aiGeneratedAt: string | null;
  confirmedAt: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  userDisplayName?: string | null;
  departmentName?: string | null;
}

export const getMyPersonalReport = (date?: string) => {
  const q = date ? `?date=${date}` : "";
  return req<{ report: PersonalDailyReportRow | null; requestedDate: string }>(`/personal-daily-report/mine${q}`);
};

export const savePersonalReport = (args: { date?: string; items: PersonalDailyReportItem[]; action: "save_draft" | "send" }) =>
  req<{ success: boolean; action: string }>("/personal-daily-report/mine/save", {
    method: "POST",
    body: JSON.stringify(args),
  });

export const regeneratePersonalReport = (date?: string) =>
  req<{ reportId: string | null; status: string; itemCount: number; errorMessage?: string }>("/personal-daily-report/mine/regenerate", {
    method: "POST",
    body: JSON.stringify({ date }),
  });

export const getTeamPersonalReports = (opts: { from?: string; to?: string } = {}) => {
  const p = new URLSearchParams();
  if (opts.from) p.set("from", opts.from);
  if (opts.to) p.set("to", opts.to);
  const q = p.toString();
  return req<{ reports: PersonalDailyReportRow[]; from: string; to: string }>(`/personal-daily-report/team${q ? `?${q}` : ""}`);
};

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

// === LLM Config ===

export type LlmProviderName = "anthropic" | "openai" | "google" | "ollama" | "deepseek";

export interface LlmConfigMasked {
  tenantId: string;
  provider: LlmProviderName;
  model: string;
  apiKeyMasked: string;
  baseUrl: string | null;
  temperature: number | null;
  maxTokens: number | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface LlmConfigGetResponse {
  config: LlmConfigMasked | null;
  providerModels: Record<LlmProviderName, string[]>;
}

// aiproot 統管 · 需帶 tenantId · 未帶或非 aiproot_admin 都會被 backend 擋
export const getLlmConfig = (tenantId: string) =>
  req<LlmConfigGetResponse>(`/llm-config?tenantId=${encodeURIComponent(tenantId)}`);

export const putLlmConfig = (payload: {
  tenantId: string;
  provider: LlmProviderName;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}) =>
  req<{ masked: string }>("/llm-config", {
    method: "PUT",
    body: JSON.stringify(payload),
  });

// 清 tenant config · 讓 backend fallback 走 env ANTHROPIC_API_KEY (平台預設)
export const deleteLlmConfig = (tenantId: string) =>
  req<{ deleted: boolean }>(`/llm-config/${encodeURIComponent(tenantId)}`, { method: "DELETE" });

// === LINE Bot / Group Registry (line-ingest module) ===

export interface LineBotDto {
  botId: string;
  tenantId: string;
  name: string;
  botUserId: string;
  channelId: string | null;
  channelSecretMasked: string;
  channelAccessTokenMasked: string;
  status: "active" | "disabled";
  webhookVerifiedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  groupCount: number;
}

export interface LineGroupRow {
  groupRegistryId: string;
  botId: string;
  groupId: string;
  displayName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  analyzeEnabled: boolean;
  firstSeenAt: string;
  lastEventAt: string;
  eventCount: number;
  status: "active" | "left";
}

export interface LineRefsDto {
  tenants: Array<{ tenantId: string; tenantName: string }>;
  departments: Array<{ departmentId: string; departmentName: string }>;
}

export const listLineBots = () =>
  req<{ bots: LineBotDto[] }>("/line-bots");

export const getLineBot = (botId: string) =>
  req<{ bot: LineBotDto; groups: LineGroupRow[] }>(`/line-bots/${botId}`);

export const getLineRefs = (tenantId?: string) =>
  req<LineRefsDto>(`/line-bots/refs${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`);

export const createLineBot = (payload: {
  tenantId: string;
  name: string;
  channelId?: string;
  channelSecret: string;
  channelAccessToken: string;
}) =>
  req<{ bot: LineBotDto }>("/line-bots", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const updateLineBot = (botId: string, patch: {
  name?: string;
  channelId?: string | null;
  channelSecret?: string;
  channelAccessToken?: string;
  status?: "active" | "disabled";
  tenantId?: string;
}) =>
  req<{ bot: LineBotDto; movedTenant?: boolean; clearedGroupDepartments?: number }>(`/line-bots/${botId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const disableLineBot = (botId: string) =>
  req<{ status: string }>(`/line-bots/${botId}`, { method: "DELETE" });

export const patchLineGroup = (groupRegistryId: string, patch: {
  departmentId?: string | null;
  displayName?: string;
  analyzeEnabled?: boolean;
}) =>
  req<{ group: LineGroupRow }>(`/line-groups/${groupRegistryId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const probeLineGroupName = (groupRegistryId: string) =>
  req<{ displayName: string | null }>(`/line-groups/${groupRegistryId}/probe-name`, { method: "POST" });

// === Tenant Admin Console (aiproot 統包客戶方組織) ===

export type UserRole = "aiproot_admin" | "consultant" | "tenant_admin" | "group_owner";

export interface DepartmentDto {
  departmentId: string;
  tenantId: string;
  departmentName: string;
  displayName: string | null;
  lineGroupId: string | null;
  extractionSchema: string | null;
  ragicTable: string | null;
  memberCount: number;
  groupBindingCount: number;
}

export interface TenantUserDto {
  userId: string;
  tenantId: string | null;
  role: UserRole;
  departmentId: string | null;
  departmentName: string | null;
  email: string | null;
  displayName: string | null;
  lineUserId: string | null;
  createdAt: string;
  hasPassword: boolean;
}

export const listDepartments = (tenantId: string) =>
  req<{ departments: DepartmentDto[] }>(`/tenant-admin/departments?tenantId=${encodeURIComponent(tenantId)}`);

export const createDepartment = (payload: { tenantId: string; departmentName: string; displayName?: string }) =>
  req<{ department: DepartmentDto }>("/tenant-admin/departments", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const updateDepartment = (departmentId: string, payload: {
  tenantId: string;
  departmentName?: string;
  displayName?: string | null;
}) =>
  req<{ department: DepartmentDto }>(`/tenant-admin/departments/${departmentId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const deleteDepartment = (departmentId: string, tenantId: string) =>
  req<{ status: string }>(`/tenant-admin/departments/${departmentId}`, {
    method: "DELETE",
    body: JSON.stringify({ tenantId }),
  });

export const listTenantUsers = (tenantId: string) =>
  req<{ users: TenantUserDto[] }>(`/tenant-admin/users?tenantId=${encodeURIComponent(tenantId)}`);

export const createTenantUser = (payload: {
  tenantId: string;
  email: string;
  role: UserRole;
  displayName?: string;
  departmentId?: string;
  password: string;
}) =>
  req<{ user: TenantUserDto }>("/tenant-admin/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const updateTenantUser = (userId: string, payload: {
  tenantId: string;
  role?: UserRole;
  displayName?: string | null;
  departmentId?: string | null;
  password?: string;
}) =>
  req<{ user: TenantUserDto }>(`/tenant-admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const deleteTenantUser = (userId: string, tenantId: string) =>
  req<{ status: string }>(`/tenant-admin/users/${userId}`, {
    method: "DELETE",
    body: JSON.stringify({ tenantId }),
  });

// === IAM: Tenant Provisioning + Password Policy ===

export interface OnboardResult {
  tenantId: string;
  adminUserId: string;
  adminEmail: string;
  initialPassword: string;             // 一次性 · 前端顯示後不 persist
  mustChangeAtFirstLogin: true;
  departments: Array<{ departmentId: string; departmentName: string }>;
}

export interface ResetPasswordResult {
  newPassword: string;
  userId: string;
  email: string | null;
  mustChangeAtNextLogin: true;
}

export const onboardTenant = (payload: {
  tenantName: string;
  industry?: string;
  adminEmail: string;
  adminDisplayName?: string;
  departments?: string[];
}) =>
  req<OnboardResult>("/tenant-provisioning/onboard", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const resetUserPassword = (userId: string, tenantId: string) =>
  req<ResetPasswordResult>(`/tenant-provisioning/users/${userId}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ tenantId }),
  });

export const unlockUser = (userId: string, tenantId: string) =>
  req<{ userId: string }>(`/tenant-provisioning/users/${userId}/unlock`, {
    method: "POST",
    body: JSON.stringify({ tenantId }),
  });

export const changePassword = (oldPassword: string, newPassword: string) =>
  req<{ status: "ok" }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ oldPassword, newPassword }),
  });

// === Permission Engine ===

export interface PermissionDto {
  permissionId: string;
  resource: string;
  action: string;
  description: string;
  scope: string;
}
export interface RoleDto {
  roleId: string;
  roleKey: string;
  roleName: string;
  tenantId: string | null;
  isSystem: boolean;
  permissions: string[];
}

export const getMyPermissions = () =>
  req<{ permissions: string[] }>("/me/permissions");
export const listPermissions = () =>
  req<{ permissions: PermissionDto[] }>("/permissions");
export const listRoles = () =>
  req<{ roles: RoleDto[] }>("/roles");

// Phase 2 · Custom role management (aiproot only)
export const createRole = (args: {
  roleKey: string;
  roleName: string;
  tenantId?: string | null;
  permissionIds: string[];
}) => req<{ roleId: string }>("/roles", {
  method: "POST",
  body: JSON.stringify(args),
});

export const updateRolePermissions = (roleId: string, permissionIds: string[]) =>
  req<{ success: boolean }>(`/roles/${roleId}/permissions`, {
    method: "PATCH",
    body: JSON.stringify({ permissionIds }),
  });

export const renameRole = (roleId: string, roleName: string) =>
  req<{ success: boolean }>(`/roles/${roleId}`, {
    method: "PATCH",
    body: JSON.stringify({ roleName }),
  });

export const deleteRole = (roleId: string) =>
  req<{ success: boolean }>(`/roles/${roleId}`, { method: "DELETE" });

export const assignUserRole = (userId: string, roleId: string) =>
  req<{ success: boolean }>(`/users/${userId}/assign-role`, {
    method: "POST",
    body: JSON.stringify({ roleId }),
  });

// === AI Cost Management ===

export interface CostSummaryDto {
  totals: {
    today: { cost: number; tokens: number; calls: number };
    month: { cost: number; tokens: number; calls: number };
    all:   { cost: number; tokens: number; calls: number };
  };
  efficiency: {
    totalMessages: number;
    avgCostPerMessage: number;
    cacheHitRate: number;
    avgSegmentSize: number;
  };
  byTenant: Array<{ tenantId: string | null; tenantName: string; cost: number; tokens: number; calls: number; messages: number; percent: number }>;
  byProvider: Array<{ provider: string; model: string; cost: number; tokens: number; calls: number; percent: number }>;
  byGroup: Array<{ groupId: string; tenantId: string | null; tenantName: string; batches: number; messages: number; cost: number; costPerMessage: number }>;
  trend30d: Array<{ date: string; cost: number; tokens: number }>;
  pricingTable: Array<{ provider: string; model: string; inputPer1M: number; outputPer1M: number; cacheReadPer1M: number; cacheWritePer1M: number }>;
  recentUploads: Array<{
    uploadId: number;
    uploadedAt: string;
    tenantId: string | null;
    tenantName: string;
    source: string;
    groupId: string | null;
    filename: string;
    messageCount: number;
    segmentCount: number;
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    tokens: number;
    calls: number;
    cost: number;
    costPerMessage: number;
    provider: string;
    model: string;
  }>;
}

export const getCostSummary = () =>
  req<CostSummaryDto>("/aiproot-console/cost/summary");

// convo-analysis-realtime batch history
export interface AnalysisBatchRow {
  batchId: string;
  tenantId: string;
  groupId: string;
  batchDate: string;
  uploadId: number | null;
  status: "pending" | "running" | "completed" | "failed" | "empty";
  messageCount: number;
  triggeredBy: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export const listAnalysisBatches = (tenantId?: string) => {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  return req<{ batches: AnalysisBatchRow[] }>(`/aiproot-console/batches${qs}`);
};

export const rerunAnalysisBatch = (body: { tenantId: string; groupId: string; batchDate: string }) =>
  req<{ batchId: string; status: string; uploadId: number | null; messageCount: number }>(
    "/aiproot-console/batches/rerun", { method: "POST", body: JSON.stringify(body) },
  );

export const runPendingBatches = (opts?: { lookbackDays?: number; tenantId?: string }) =>
  req<{ total: number; completed: number; empty: number; failed: number }>(
    "/aiproot-console/batches/run-pending",
    { method: "POST", body: JSON.stringify(opts ?? {}) },
  );

// aiproot 通用 · 列所有租戶（下拉篩選用）
export interface AiprootTenantOption {
  tenantId: string;
  tenantName: string;
  batchEnabled: boolean;
}
export const listAiprootTenants = () =>
  req<{ tenants: AiprootTenantOption[] }>("/aiproot-console/tenants");

// convo-analysis-realtime · aiproot 切 tenant 是否啟用 cron batch
export const setTenantBatchEnabled = (tenantId: string, enabled: boolean) =>
  req<{ tenantId: string; batchEnabled: boolean }>(
    `/aiproot-console/tenants/${tenantId}/batch-enabled`,
    { method: "PATCH", body: JSON.stringify({ enabled }) },
  );

// employee-line-binding · aiproot audit + nudge
export interface BindingAuditRow {
  bindingId: string;
  userId: string;
  userDisplayName: string | null;
  userEmail: string | null;
  lineUserId: string;
  boundAt: string;
  bindingMethod: string;
  status: string;
}
export const listBindingAudit = (tenantId: string, status?: "active" | "revoked") => {
  const params = new URLSearchParams({ tenantId });
  if (status) params.set("status", status);
  return req<{ bindings: BindingAuditRow[] }>(`/binding/aiproot/list?${params}`);
};
export const revokeBindingAiproot = (bindingId: string) =>
  req<{ success: boolean }>(`/binding/aiproot/revoke/${bindingId}`, { method: "POST", body: "{}" });

export interface UnboundStats {
  tenantId: string;
  tenantName: string;
  unboundCount: number;
  top: Array<{ senderLineId: string; displayName: string | null; messageCount: number; topGroupName: string | null }>;
}
export const getUnboundStats = () =>
  req<{ stats: UnboundStats[] }>("/binding/aiproot/unbound-stats");
