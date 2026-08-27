// 後端 API client。dev 走 Vite proxy（/api → :3000）。

// i18n：登入時套用使用者存在伺服器的語言（見 getMyPermissions）
import { getLocale, setLocale, t } from "./i18n";

/**
 * 知會其他人（不改變當責人）· 只發個人私訊，不碰群組。
 * ⚠️ 刻意是獨立端點而不是塞進 assignTicket —— 指派是「一次點擊、零個選擇」，
 *    加勾選會讓每次指派都多一輪判斷，而知會別人是少數情況。
 */
export const notifyOthers = (ticketId: string, userIds: string[]) =>
  req<{ results: Array<{ userId: string; name: string | null; notified: boolean; reason: string | null }> }>(
    `/warroom/tickets/${ticketId}/notify-others`,
    { method: "POST", body: JSON.stringify({ userIds }) },
  );

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

export type Role = "aiproot_admin" | "consultant" | "tenant_admin" | "group_owner" | "employee";
export interface Session {
  email: string;
  displayName: string | null;          // 顯示名稱（topbar 用）· 來自 /me/permissions 或自服務改名
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
const DISPLAY_KEY = "acl.display_name";

let token: string | null = localStorage.getItem(TOKEN_KEY);
export const getToken = () => token;

// 誰在用：PermissionProvider 掛在 App 之上（含登入頁），登入時 App 內部 setState
// 不會讓它重新執行 effect —— 沒有這個訊號，登入後權限永遠不會去抓（要手動重新整理才會好）。
const tokenListeners = new Set<() => void>();
export function onTokenChange(fn: () => void): () => void {
  tokenListeners.add(fn);
  return () => { tokenListeners.delete(fn); };
}

function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
  tokenListeners.forEach((fn) => fn());
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
    displayName: localStorage.getItem(DISPLAY_KEY) || null,
    role: (p.role as Role) ?? "group_owner",
    tenantId: (p.tenant_id as string) ?? "",
    departmentId: (p.department_id as string | null) ?? null,
    exp: (p.exp as number) ?? 0,
    mustChangePassword: localStorage.getItem(MUST_CHANGE_KEY) === "1",
    passwordExpiresAt: localStorage.getItem(EXPIRES_AT_KEY),
  };
}

// 顯示名稱寫入 localStorage 並通知（App 會重讀 session、topbar 更新）· 空值＝清掉（回退 email 前綴）
export function setLocalDisplayName(name: string | null) {
  if (name) localStorage.setItem(DISPLAY_KEY, name);
  else localStorage.removeItem(DISPLAY_KEY);
  tokenListeners.forEach((fn) => fn());
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
  localStorage.removeItem("acl.perms_id");
  localStorage.removeItem(DISPLAY_KEY);
}

export class ApiError extends Error {
  /**
   * server 回的原始 JSON body。
   *
   * ⚠️ 有機器碼可比對時**一律比機器碼，不要比訊息文字** ——
   * 訊息現在會隨語言變（i18n.md M4b），比文字的判斷會在切英文時靜默失效。
   * 例：密碼政策用 `body.status === "password_policy_violation"`。
   */
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

// HTTP status → 使用者可讀訊息；避免把 Nest 預設英文（Internal server error / Unauthorized）
// 直接秀給客戶。真正原因保留在 console（dev）供除錯。
//
// ⚠️ 這裡只管**通用 fallback**。server 特意寫的訊息會優先採用（見 GENERIC_SERVER_MSG）。
//    2026-08-27 M4b 起 server 也吃 `Accept-Language`（每個請求都帶），
//    所以那些訊息會依語言回中文或英文。
function friendlyStatusMessage(status: number): string {
  if (status === 400) return t("err.400");
  if (status === 401) return t("err.401");
  if (status === 403) return t("err.403");
  if (status === 404) return t("err.404");
  if (status === 409) return t("err.409");
  if (status === 422) return t("err.422");
  if (status === 429) return t("err.429");
  if (status >= 500) return t("err.500");
  return t("err.unknown");
}

// 若 server 特意寫了訊息（非 Nest 預設），優先使用；否則走 status mapping。
//
// ⚠️ 原本的判準是「訊息裡有沒有中文」—— M4b 之後 server 也會回英文，
//    那個判準會把 server 特意寫的英文訊息當成 Nest 預設蓋掉。
//    真正的判準從來都是「是不是 Nest 的預設字串」，就是下面這條。
const GENERIC_SERVER_MSG = /^(internal server error|bad request|not found|forbidden|unauthorized|too many requests|unprocessable entity|conflict|payload too large)$/i;

// 登入流程本身的端點：這裡回 401 = 這次登入嘗試失敗（帳密錯 / LINE 未綁定 /
// LINE 授權失敗），不是「既有 session 過期」。不可清 token、也不可用「工作階段已過期」
// 蓋掉 server 的真實原因，否則使用者（尤其 LINE 登入）會看到誤導訊息。
const PRE_AUTH_PATHS = new Set(["/auth/login", "/auth/line/callback", "/auth/line/oauth-url", "/auth/liff/token"]);

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
        // 後端錯誤訊息的語言來源（i18n.md M4b）· 每個請求都帶，包含還沒登入的
        "accept-language": getLocale(),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
    });
  } catch (e) {
    // 網路失敗（離線、DNS、CORS block、server down）
    if (import.meta.env.DEV) console.error(`[api] network failure on ${path}`, e);
    throw new ApiError(0, t("err.network"));
  }

  if (res.status === 401 && !PRE_AUTH_PATHS.has(path)) {
    logout();
    throw new ApiError(401, t("err.expired"));
  }

  if (!res.ok) {
    let serverMsg = "";
    let body: unknown;
    try {
      body = await res.clone().json();
      const m = (body as { message?: unknown } | null)?.message;
      if (typeof m === "string") serverMsg = m.trim();
      else if (Array.isArray(m)) serverMsg = m.join("; ");
    } catch {
      // not JSON
    }
    const isGeneric = !serverMsg || GENERIC_SERVER_MSG.test(serverMsg);
    const friendly = isGeneric ? friendlyStatusMessage(res.status) : serverMsg;
    if (import.meta.env.DEV) console.error(`[api] ${path} → ${res.status}`, serverMsg || "(no body)");
    throw new ApiError(res.status, friendly, body);
  }
  // 2xx 但拿到非 JSON（常見於 Static Site 的 SPA fallback 抓到 API 路徑，回 index.html）
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (import.meta.env.DEV) console.error(`[api] ${path} → 2xx 但非 JSON · content-type=${contentType} · 可能是 _redirects 沒生效`);
    throw new ApiError(0, t("err.badFormat"));
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

// LINE Login OAuth · 走 LIFF 的 same LINE Login channel
export async function getLineOauthUrl(): Promise<{ url: string; state: string }> {
  return req<{ url: string; state: string }>("/auth/line/oauth-url");
}

export interface TenantChoice {
  needsTenantChoice: true;
  selectionToken: string;
  options: Array<{ tenantId: string | null; tenantName: string | null; role: string }>;
}
type LineLoginResp =
  | { access_token: string; role: string; tenant_id: string | null }
  | TenantChoice;

function finishLineLogin(d: { access_token: string; tenant_id: string | null }) {
  setToken(d.access_token);
  // LINE 登入不走 email/密碼 · 記錄 email 用預設佔位
  localStorage.setItem(EMAIL_KEY, `line-user@${d.tenant_id ?? "aiproot"}`);
  localStorage.removeItem(MUST_CHANGE_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
}

// 回傳 null = 已登入；回傳 TenantChoice = 一人多租戶、需選組織（B）
export async function completeLineOauth(code: string, state?: string): Promise<TenantChoice | null> {
  const d = await req<LineLoginResp>("/auth/line/callback", {
    method: "POST",
    body: JSON.stringify({ code, state }),
  });
  if ("needsTenantChoice" in d) return d;
  finishLineLogin(d);
  return null;
}

export async function selectLineTenant(selectionToken: string, tenantId: string): Promise<void> {
  const d = await req<{ access_token: string; role: string; tenant_id: string | null }>("/auth/line/select-tenant", {
    method: "POST",
    body: JSON.stringify({ selectionToken, tenantId }),
  });
  finishLineLogin(d);
}

// LIFF · 用 liff.getAccessToken() 換 JWT（後端驗 channel+效期+profile · 見 /auth/liff/token）
// 401 未綁定會以 ApiError 拋出真實訊息（/auth/liff/token 在 PRE_AUTH_PATHS · 不被蓋成「工作階段過期」）
// botId：LIFF 從特定租戶的 bot 開 → 傳給後端綁死租戶（一人多租戶時才不會登入到別家）
export async function applyLiffToken(accessToken: string, botId?: string): Promise<{ role: string; tenant_id: string | null }> {
  const d = await req<{ access_token: string; role: string; tenant_id: string | null }>("/auth/liff/token", {
    method: "POST",
    body: JSON.stringify({ accessToken, botId }),
  });
  setToken(d.access_token);
  localStorage.setItem(EMAIL_KEY, `line-user@${d.tenant_id ?? "aiproot"}`);
  localStorage.removeItem(MUST_CHANGE_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
  return { role: d.role, tenant_id: d.tenant_id };
}

// === LIFF 綁定 / 設密碼（@Public 端點 · 無 JWT）===
export interface LiffPrefill {
  status: "new" | "already_bound";
  existing?: { userDisplayName: string; boundAt: string };
  prefill?: {
    displayName: string | null;
    pictureUrl: string | null;
    candidateGroups: Array<{ groupId: string; displayName: string | null; departmentName: string | null; messageCount: number }>;
  };
}
export const liffGetPrefill = (botId: string, lineUserId: string) =>
  req<LiffPrefill>(`/binding/liff/prefill?botId=${botId}&lineUserId=${encodeURIComponent(lineUserId)}`);

// complete / set-password 走 accessToken（後端驗證取可信 userId · 修 IDOR）
export const liffCompleteBinding = (args: { botId: string; accessToken: string; displayName: string; metadata?: Record<string, unknown> }) =>
  req<{ displayName: string; departmentName: string | null; departmentSource: string }>(
    "/binding/liff/complete",
    { method: "POST", body: JSON.stringify(args) },
  );
export const liffSetPassword = (args: { botId: string; accessToken: string; email: string; password: string }) =>
  req<{ success: boolean; email: string }>(
    "/binding/liff/set-password",
    { method: "POST", body: JSON.stringify(args) },
  );

// === 外勤打卡 + 里程（JWT）===
export interface PunchResult {
  punchId: string;
  suspicious: Record<string, number> | null;
  trip: { distanceM: number | null; routeProvider: string | null } | null;
}
export const attendancePunch = (body: { punchType: "clock_in" | "arrive_site" | "clock_out"; lat?: number; lng?: number; accuracyM?: number; customerName?: string }) =>
  req<PunchResult>("/attendance/punch", { method: "POST", body: JSON.stringify(body) });

export interface TripRow {
  tripId: string;
  distanceM: number | null;
  straightDistanceM: number | null;
  routeProvider: string | null;
  routeGeometry: string | null;         // encoded polyline · null = 未記錄
  destination: string | null;
  fromLat: number | null; fromLng: number | null;
  toLat: number | null; toLng: number | null;
  fromAddress: string | null; toAddress: string | null;
  departedAt: string;
  arrivedAt: string;
}
export interface PunchRow {
  punchId: string;
  punchType: string;
  customerName: string | null;
  address: string | null;
  lat: number | null; lng: number | null;
  punchedAt: string;
}
// 補填/修正某次打卡的地點名稱（只改標籤 · 座標時間里程不可改）
export const relabelPunch = (punchId: string, customerName: string | null) =>
  req<{ punchId: string; customerName: string | null }>(`/attendance/punch/${punchId}/label`, {
    method: "PATCH", body: JSON.stringify({ customerName }),
  });
// date 選填（YYYY-MM-DD，台北日）· 省略＝當日 · 回行程 + 打卡序列
export const getTrips = (date?: string) =>
  req<{ trips: TripRow[]; punches: PunchRow[] }>(`/attendance/trips${date ? `?date=${encodeURIComponent(date)}` : ""}`);
// 地圖圖磚設定（前端 Leaflet 用 · tileApiKey 為 client-side key · osm 為 null）
export const getMapTileConfig = () =>
  req<{ tileProvider: string; tileApiKey: string | null }>("/attendance/map-tile-config");

// 地圖設定（aiproot）· routing provider + tile provider
export const getMapConfig = () =>
  req<{ provider: string; hasKey: boolean; tileProvider: string; hasTileKey: boolean; pendingBackfill: number }>("/aiproot-console/map-config");
// 補算里程（地圖服務中斷期間沒算出來的段落）
export const backfillMileage = (limit = 100) =>
  req<{ pendingBefore: number; attempted: number; succeeded: number; failed: number; remaining: number; stoppedEarly: boolean; errors: string[] }>(
    "/aiproot-console/map-config/backfill", { method: "POST", body: JSON.stringify({ limit }) });
export const setMapConfig = (body: { provider: string; apiKey?: string }) =>
  req<{ status: string; provider: string; hasKey: boolean }>("/aiproot-console/map-config", { method: "POST", body: JSON.stringify(body) });
// 連線測試 · 實打一次 provider · 回真實錯誤供診斷
export const testMapRouting = () =>
  req<{ ok: boolean; provider: string | null; distanceM?: number; hasPolyline?: boolean; error?: string }>(
    "/aiproot-console/map-config/test", { method: "POST" });
export const setMapTileConfig = (body: { tileProvider: string; tileApiKey?: string }) =>
  req<{ status: string; tileProvider: string; hasTileKey: boolean }>("/aiproot-console/map-config/tile", { method: "POST", body: JSON.stringify(body) });

// === notify v2 · 自助通知設定（aiproot）===
export interface RagicAccountRow { accountId: string; tenantId: string | null; server: string; apname: string; displayName: string; hasKey: boolean }
export interface RagicSchemaField { fieldId: number; fieldName: string; type: string }
export type NotifySourceType = "ragic_form" | "internal_event";
export type NotifyChannelType = "line_group" | "line_user";
export interface NotifyFieldSel { path: string; label: string; order: number }
/** 通知規則（來源/管道無關）*/
export interface NotifyRuleRow {
  ruleId: string; name: string; enabled: boolean;
  sourceType: NotifySourceType; sourceLabel: string;
  channelType: NotifyChannelType; channelTarget: string | null; channelLabel: string;
  fieldCount: number; webhookToken: string | null; accountDisplayName: string | null; eventsLabel: string;
  /** 通知欄位的中文名 · 搜尋要搜得到「哪條規則會通知『客戶簽回』」 */
  fieldLabels: string[];
}
export interface EventFieldDef { path: string; label: string; numeric?: boolean }
export interface EventDef { eventType: string; label: string; description: string; fields: EventFieldDef[] }
export interface LineGroupOption { groupId: string; displayName: string | null }
export interface NotifiableUser { userId: string; name: string }

// Ragic webhook 要打 prod backend；dev 顯示也用 prod URL（Ragic 必須連得到）
export const notifyWebhookUrl = (token: string) =>
  `${API_BASE || "https://ai-center-line.onrender.com"}/notify/webhook/${token}`;

export interface NotifyLogRow {
  receivedAt: string; status: string; sourceRef: string | null; recordId: number | null;
  lineStatus: number | null; lineMessage: string | null; latencyMs: number | null;
  messageText: string | null; sourceType: string | null; channel: string | null;
  ruleId: string | null; ruleName: string | null; audit: Record<string, unknown> | null;
}
// 通知紀錄（排查「改了為什麼沒通知」）
export interface NotifyLogPage {
  rows: NotifyLogRow[];
  total: number;
  /** 各狀態筆數 · 不受 status 篩選影響（受時間範圍與規則影響）*/
  statusCounts: Record<string, number>;
}
export const ncListLogs = (params: {
  page: number; pageSize: number;
  ruleId: string | undefined; status: string | undefined;
  /** YYYY-MM-DD（台北）· undefined＝不限 */
  from: string | undefined;
}) => {
  const q = new URLSearchParams();
  q.set("page", String(params.page));
  q.set("pageSize", String(params.pageSize));
  if (params.ruleId) q.set("ruleId", params.ruleId);
  if (params.status) q.set("status", params.status);
  if (params.from) q.set("from", params.from);
  return req<NotifyLogPage>(`/notify-config/logs?${q.toString()}`);
};

export const ncListAccounts = () => req<RagicAccountRow[]>("/notify-config/accounts");
export const ncCreateAccount = (body: { tenantId?: string | null; server: string; apname: string; displayName: string; apiKey?: string }) =>
  req<{ accountId: string }>("/notify-config/accounts", { method: "POST", body: JSON.stringify(body) });
export const ncUpdateKey = (accountId: string, apiKey: string) =>
  req<{ status: string }>(`/notify-config/accounts/${accountId}/key`, { method: "POST", body: JSON.stringify({ apiKey }) });
export const ncRenameAccount = (accountId: string, displayName: string) =>
  req<{ status: string }>(`/notify-config/accounts/${accountId}/name`, { method: "POST", body: JSON.stringify({ displayName }) });
export interface RagicSchemaResult { sheetName: string; fields: RagicSchemaField[] }
export const ncFetchFields = (accountId: string, sheetPath: string) =>
  req<RagicSchemaResult>(`/notify-config/accounts/${accountId}/fields?sheetPath=${encodeURIComponent(sheetPath)}`);
// 目標群下拉 · 不經 ragic 帳號（prod 上那些帳號的 tenant_id 是 NULL，走帳號會永遠回空）
export interface NcLineGroup { groupId: string; displayName: string | null; tenantName: string | null }
export const ncAllLineGroups = () => req<NcLineGroup[]>("/notify-config/line-groups");

/**
 * 可選的「發送機器人 + 該機器人所在的群組」。
 * 群組依 bot 過濾 —— LINE 的群組 ID 依 bot 發放，挑到別支的群就是 400 且看不出原因。
 */
export interface NcSendableTarget {
  botId: string;
  botName: string;
  tenantId: string | null;
  tenantName: string | null;
  groups: Array<{ groupId: string; displayName: string | null }>;
}
export const ncSendableTargets = () => req<NcSendableTarget[]>("/notify-config/sendable-targets");

/** 這個群組屬於哪支 bot（逐支問 LINE）· 補既有規則用 */
export const ncWhichBotInGroup = (groupId: string) =>
  req<Array<{ botId: string; botName: string; tenantName: string | null; groupName: string | null }>>(
    `/notify-config/which-bot-in-group?groupId=${encodeURIComponent(groupId)}`);
export const ncEventCatalog = () => req<EventDef[]>("/notify-config/event-catalog");
export const ncNotifiableUsers = (tenantId?: string) =>
  req<NotifiableUser[]>(`/notify-config/notifiable-users${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`);
export const ncListRules = () => req<NotifyRuleRow[]>("/notify-config");

/** 單條規則完整內容 · 編輯畫面預填用 */
export interface NotifyRuleDetail {
  ruleId: string; name: string; sourceType: NotifySourceType;
  /** 用哪支 bot 發送（0061）· 舊規則為 null */
  botId?: string | null;
  ragicAccountId: string | null; sheetPath: string | null; sheetName: string | null;
  eventType: string | null;
  notifyCreate: boolean; notifyUpdate: boolean; notifyDelete: boolean;
  title: string | null;
  fields: Array<{ path: string; label: string; order: number }>;
  channelType: NotifyChannelType; channelTarget: string | null;
}
export const ncGetRule = (ruleId: string) => req<NotifyRuleDetail>(`/notify-config/${ruleId}`);
export const ncUpdateRule = (ruleId: string, body: {
  name?: string; title?: string | null;
  notifyCreate?: boolean; notifyUpdate?: boolean; notifyDelete?: boolean;
  fields?: Array<{ path: string; label: string; order: number }>;
  channelType?: string; channelTarget?: string;
  /** 用哪支 bot 發送（0061）*/
  botId?: string;
  /** 換 Ragic 帳號（同一張表單改讀另一個 Ragic 資料庫）· webhook 網址不變 */
  ragicAccountId?: string;
}) => req<{ status: string }>(`/notify-config/${ruleId}`, { method: "PATCH", body: JSON.stringify(body) });
export const ncCreateRule = (body: {
  name: string; sourceType: NotifySourceType;
  ragicAccountId?: string; sheetPath?: string; sheetName?: string;
  notifyCreate?: boolean; notifyUpdate?: boolean; notifyDelete?: boolean;
  eventType?: string; filters?: Array<{ path: string; op: "eq" | "gte" | "lte"; value: string | number }>;
  title: string | null; fields: NotifyFieldSel[];
  channelType: NotifyChannelType; channelTarget: string;
  /**
   * 用哪支 bot 發送 · line_group 必填（群組 ID 依 bot 發放）。
   * ⚠️ 刻意寫成「必填但可為 undefined」而非 `botId?:` —— 這個 key 曾經在建立路徑被整個漏掉
   * （更新路徑有、建立路徑沒有），選填型別讓 tsc 抓不到，要到後端才回「請選擇機器人」。
   */
  botId: string | undefined;
}) => req<{ ruleId: string; webhookToken: string | null }>("/notify-config", { method: "POST", body: JSON.stringify(body) });
export const ncSetEnabled = (ruleId: string, enabled: boolean) =>
  req<{ status: string }>(`/notify-config/${ruleId}/enabled`, { method: "PATCH", body: JSON.stringify({ enabled }) });
export const ncRemove = (ruleId: string) =>
  req<{ status: string }>(`/notify-config/${ruleId}`, { method: "DELETE" });
export const getWarroom = () => req<Warroom>("/warroom");
export const getPending = () => req<{ pending: PendingTicket[] }>("/signoff");
export const confirmSignoff = (ticket_ids: string[]) =>
  req<ConfirmResult>("/signoff", { method: "POST", body: JSON.stringify({ ticket_ids }) });

// === Warroom Task Board · WTB-M3 ===

// 任務卡來源原文 · 核對前對照 AI 抽取結果與原始訊息
export interface SourceMessage {
  id: number;
  time: string;
  sender: string;
  text: string;
  kind: string;
  /** 這一則帶的照片／影片 · null = 這則不是媒體訊息 */
  media: { mediaId: string; kind: string } | null;
}

export interface TicketSource {
  summary: string;
  extracted: Record<string, unknown> | null;
  messages: SourceMessage[];
  /**
   * 有沒有留下「哪幾則訊息」的連結。
   * ⚠️ false 與「這幾則訊息沒有照片」是兩件事：前者是我們不知道，後者是確定沒有。
   */
  hasSourceLink: boolean;
  unavailableReason: string | null;
}
export const getTicketSource = (ticketId: string) =>
  req<TicketSource>(`/warroom/tickets/${ticketId}/source`);

// 指派任務的原始對話（員工日報用）· 部門制 gate：只有任務屬本人部門才回，跨部門 403
export const getAssignedTaskSource = (ticketId: string) =>
  req<TicketSource>(`/personal-daily-report/assigned-tasks/${ticketId}/source`);

// 任務歸屬 · 導入期由主管手動派（員工綁定 LINE 後才會自動歸屬）
export interface AssignableMember { userId: string; name: string; hasLineBinding: boolean }
export const getAssignableMembers = () =>
  req<{ members: AssignableMember[] }>("/warroom/assignable-members");
export const assignTicket = (ticketId: string, assigneeUserId: string | null) =>
  req<{
    ticketId: string; assignStatus: string; assigneeUserId: string | null; assigneeName: string | null;
    /** 有沒有真的私訊到當事人 · 送不出去而畫面沒說，主管會以為對方知道了 */
    notified: boolean;
    notifySkipReason: "no_binding" | "no_bot" | "disabled" | "already_notified" | "push_failed" | null;
  }>(
    `/warroom/tickets/${ticketId}/assignee`,
    { method: "PATCH", body: JSON.stringify({ assigneeUserId }) },
  );

export interface WarroomKanbanTicket {
  ticketId: string;
  category: string | null;
  categoryId: string | null;
  summary: string;
  confidence: "high" | "medium" | "low" | null;
  confirmStatus: "待簽核" | "已簽核" | "逾時警示" | "待確認" | "已忽略" | "存查";
  /** 記錄本身的狀態 · 存查區用來分辨是公告還是已完成 */
  status: string | null;
  assigneeDisplayName: string | null;
  assigneeUserId: string | null;
  assigneeAccountName: string | null;
  assignStatus: "none" | "unclaimed" | "assigned";
  dueAt: string | null;
  sourceUploadId: number | null;
  sourceRecordIndex: number | null;
  createdAt: string;
  departmentId: string;
  departmentName: string | null;
  groupName: string | null;
  categoryName: string | null;   // 客戶自訂的分類中文名（category_registry）
  confirmedByName: string | null;
  confirmedAt: string | null;
  // 第四條軸 · 擁有者是當責人本人（前三條是 AI／主管／歸屬）
  workStatus: "open" | "closed" | "record";
  workOutcome: string | null;
  workClosedVia: "line_reply" | "web" | "system" | null;
  /** 有值代表是別人代結的 · UI 要明示（doc F-5） */
  workClosedByName: string | null;
  workLastReportAt: string | null;
  workLastReportNote: string | null;
  /** 四軸投影後的對外單一狀態 · 由後端算，前端不要自己拼（措辭鐵則在後端） */
  displayState: string;
  /** 卡住幾天 · null = 沒卡住（正常的卡片不長 pill · 全部都顯眼＝沒有重點） */
  stuckDays: number | null;
  /** unassigned → 主管要催派工；no_report → 主管要問障礙 */
  stuckKind: "unassigned" | "no_report" | null;
  /** 逾時幾天 · due_at 為 null 時由建立日算 */
  overdueDays: number | null;
}

export interface WarroomTaskBoard {
  kanban: {
    pending: WarroomKanbanTicket[];
    signed: WarroomKanbanTicket[];
    overdue: WarroomKanbanTicket[];
    unconfirmed: WarroomKanbanTicket[];   // 中信心 · 等主管決定要不要追
  };
  counts: {
    pending: number; signed: number; overdue: number; unconfirmed: number;
    /** 存查總數 · 卡片走 getArchivedTasks 分頁取，不在看板回應裡 */
    archived: number;
    /** 卡住的張數 · 給「只看卡住的」篩選用 */
    stuck: number;
  };
}

export interface WarroomDailyReport {
  uploadId: number;
  groupId: string;
  groupName: string | null;
  /** null = 這個群還沒分派部門 —— 分析會跑，但一張任務都不會建 */
  departmentId: string | null;
  departmentName: string | null;
  batchDate: string;
  dailyReports: Array<Record<string, unknown>>;
  records: Array<Record<string, unknown>>;    // AI 抽的分類記錄 · daily_reports 空 (業務對話) 時 fallback 顯
  serviceIntake: Array<Record<string, unknown>>;   // 客服報修派工單 · 獨立一區，不進 fallback 鏈
  status: string;
  uploadedAt: string;
  /** 這一天這個群的分析沒有完成 —— 要顯示「尚未整理」而不是「當日無資料」 */
  analysisIncomplete: boolean;
}

export interface WarroomDailyDays {
  days: Array<{ batchDate: string; uploads: WarroomDailyReport[] }>;
  /** 批次幾點自動跑 · 每家自己設 · null = 已關閉 */
  batchRunAt?: string | null;
}

export const getWarroomTasks = (opts: { includeSigned?: boolean } = {}) => {
  const q = opts.includeSigned === false ? "?signed=false" : "";
  return req<WarroomTaskBoard>(`/warroom/tasks${q}`);
};

export interface ArchiveGroupOption { groupId: string; name: string }
export interface ArchivedTasksResult {
  items: WarroomKanbanTicket[];
  total: number;
  groups: ArchiveGroupOption[];
  page: number;
  pageSize: number;
}
/**
 * 存查 · 獨立分頁查詢（不是從看板那份切）。
 * 看板只撈最近 500 筆，而存查的用途正是「找回三個月前那件事」。
 */
export const getArchivedTasks = (
  page: number, f: { from?: string; to?: string; groupId?: string; q?: string } = {},
) => {
  const q = new URLSearchParams({ page: String(page) });
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (f.groupId) q.set("groupId", f.groupId);
  if (f.q) q.set("q", f.q);
  return req<ArchivedTasksResult>(`/warroom/tasks/archived?${q}`);
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

export interface PendingRawMessage {
  messageId: string;
  messageType: string;
  textContent: string | null;
  sentAt: string;
}

export const getMyPersonalReport = (date?: string) => {
  const q = date ? `?date=${date}` : "";
  return req<{
    report: PersonalDailyReportRow | null;
    requestedDate: string;
    /** AI 幾點自動整理 · 每家自己設 · null = 已關閉或看不懂的 cron，文案要改成泛稱 */
    aiRunAt: string | null;
    pendingMessageCount: number;
  assignedTasks?: Array<{ ticketId: string; summary: string | null; category: string | null; createdAt: string; canSeeSource?: boolean }>;
  /** 今天打卡去過的地方 · 由本人決定要不要納入日報（4FR §5） */
  todayVisits?: Array<{ place: string; at: string }>;
    pendingMessages: PendingRawMessage[];
    userDisplayName: string;
    tenantName: string;
  }>(`/personal-daily-report/mine${q}`);
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

// tenantId：平台角色必須指定要看哪一家 —— 不指定會多家混在一起，
// 且 departments 因 RLS 而 JOIN 不到，部門一律顯示「未分派」
export const getTeamPersonalReports = (opts: { from?: string; to?: string; tenantId?: string } = {}) => {
  const p = new URLSearchParams();
  if (opts.from) p.set("from", opts.from);
  if (opts.to) p.set("to", opts.to);
  if (opts.tenantId) p.set("tenantId", opts.tenantId);
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

// 跨批標記洞察（label-driven-improvement M1+M2）· aiproot 看全、租戶看自家
export interface LabelInsights {
  accuracy: Record<"classification" | "daily_report" | "record", { total: number; correct: number }>;
  errors: Array<{
    uploadId: number; targetType: "classification" | "daily_report" | "record"; targetId: string;
    tenantSlug: string; filename: string; content: string; category: string | null; note: string | null; labeledAt: string;
  }>;
}
export const getLabelInsights = () =>
  req<LabelInsights>("/conversation-analysis/label-insights");

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
  /** 各 provider 的建議模型 · 只是預選清單，不是白名單（可自訂輸入）*/
  providerModels: Record<LlmProviderName, string[]>;
  /** 租戶沒設定時實際會用的平台預設（來自 server env）· 別在前端寫死 */
  platformDefault: {
    provider: LlmProviderName;
    model: string;
    apiKeyConfigured: boolean;
  };
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
  tenantId: string | null;             // utility bot（群組 ID 小幫手）無租戶
  kind: "analysis" | "utility";
  name: string;
  botUserId: string;
  channelId: string | null;
  channelSecretMasked: string;
  channelAccessTokenMasked: string;
  status: "active" | "disabled";
  webhookVerifiedAt: string | null;
  /** 0060 · 這支 bot 專用的 LIFF（須與其 channel 同 provider）· null＝用系統預設 */
  liffId: string | null;
  loginChannelId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  groupCount: number;
}

/** 0068 · 群組類型 · 只有 department 定義組織 */
export type LineGroupType = "department" | "process" | "announcement" | "test";
// ⚠️ 2026-08-26 i18n：文字搬進 i18n/*.ts（key = `groupType.<值>` / `groupTypeHint.<值>`）。
//    `LineGroupType` 的值是 DB 值（line_group.group_type），**不可翻**。
export const GROUP_TYPES: LineGroupType[] = ["department", "process", "announcement", "test"];
export const groupTypeLabel = (v: LineGroupType) => t(`groupType.${v}`);
/** 下拉旁邊那句說明 —— 少了它，使用者無從判斷該選哪個 */
export const groupTypeHint = (v: LineGroupType) => t(`groupTypeHint.${v}`);

export interface LineGroupRow {
  groupRegistryId: string;
  botId: string;
  groupId: string;
  displayName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  analyzeEnabled: boolean;
  /** bot 在這個群要不要回話（完成回報確認 / 每日回報清單）· 與 analyzeEnabled 是兩件事 */
  replyEnabled: boolean;
  /** 0068 · 只有 department 型會定義組織歸屬（group-type-classification.md）*/
  groupType: LineGroupType;
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
  kind?: "analysis" | "utility";       // 預設 analysis · utility＝群組 ID 小幫手（免租戶）
  tenantId?: string;
  name: string;
  channelId?: string;
  channelSecret: string;
  channelAccessToken: string;
  liffId?: string;
  loginChannelId?: string;
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
  liffId?: string | null;              // null＝清空、退回系統預設
  loginChannelId?: string | null;
}) =>
  req<{ bot: LineBotDto; movedTenant?: boolean; clearedGroupDepartments?: number }>(`/line-bots/${botId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const disableLineBot = (botId: string) =>
  req<{ status: string }>(`/line-bots/${botId}`, { method: "DELETE" });

/** 停用中的 bot 重新啟用 */
export const enableLineBot = (botId: string) =>
  req<{ bot: LineBotDto }>(`/line-bots/${botId}`, {
    method: "PATCH", body: JSON.stringify({ status: "active" }),
  });

/** 永久刪除前先看會連帶刪掉什麼（全是 CASCADE） */
export interface LineBotDeleteImpact {
  botName: string; status: string;
  groups: number; messages: number; members: number; bindings: number;
}
export const lineBotDeleteImpact = (botId: string) =>
  req<LineBotDeleteImpact>(`/line-bots/${botId}/delete-impact`);
export const deleteLineBotPermanently = (botId: string) =>
  req<{ status: string }>(`/line-bots/${botId}/permanent`, { method: "DELETE" });

export const patchLineGroup = (groupRegistryId: string, patch: {
  departmentId?: string | null;
  displayName?: string;
  analyzeEnabled?: boolean;
  replyEnabled?: boolean;
  /** 把「已離開的群」移出清單（隱藏，非刪除 · 歷史資料仍保留群名）*/
  hidden?: boolean;
  /** 0068 · 群組類型 · 只有 department 定義組織歸屬 */
  groupType?: LineGroupType;
}) =>
  req<{ group: LineGroupRow }>(`/line-groups/${groupRegistryId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const probeLineGroupName = (groupRegistryId: string) =>
  req<{ displayName: string | null }>(`/line-groups/${groupRegistryId}/probe-name`, { method: "POST" });

// === Tenant Admin Console (aiproot 統包客戶方組織) ===

export type UserRole = "aiproot_admin" | "consultant" | "tenant_admin" | "group_owner" | "assistant" | "employee";

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
  /** 綁在此部門的 LINE 群名 · 講「哪一群」而不是只講「1 個」（舊版本後端可能沒有這欄）*/
  boundGroupNames?: string[];
}

export interface TenantUserDto {
  userId: string;
  tenantId: string | null;
  role: UserRole;
  departmentId: string | null;
  departmentName: string | null;
  /** MDA · 'auto'=系統推導 / 'manual'=有人手動指派 · 前端據此標來源 */
  departmentSource: "auto" | "manual";
  email: string | null;
  displayName: string | null;
  lineUserId: string | null;
  createdAt: string;
  hasPassword: boolean;
  /** 自訂角色的 role_id · null ＝ 用內建角色（custom-roles v0.3）*/
  roleId?: string | null;
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

// MDA · 分配成員部門（tenant_admin 可用）· 只改部門，不碰角色/密碼
export const assignUserDepartment = (userId: string, payload: { tenantId: string; departmentId: string | null }) =>
  req<{ user: TenantUserDto }>(`/tenant-admin/users/${userId}/department`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const deleteTenantUser = (userId: string, tenantId: string) =>
  req<{ status: string }>(`/tenant-admin/users/${userId}`, {
    method: "DELETE",
    body: JSON.stringify({ tenantId }),
  });

// 組織關係圖（org-overview M1）· aiproot 帶 tenantId 看任一家 / tenant_admin 鎖自租戶
export interface OrgMember { name: string; role: string; hasLineBinding: boolean; departmentSource: "auto" | "manual" }
/** 0068 · 不定義組織的群 · 不畫進部門樹、不進健康度分母 */
export interface OrgCrossGroup { name: string; groupType: string; memberCount: number }
export interface OrgOverview {
  company: string;
  gm: string[];
  departments: Array<{ name: string; groups: string[]; members: OrgMember[] }>;
  crossGroups: OrgCrossGroup[];
  unassigned: { groups: string[]; members: OrgMember[] };
}
export const getOrgOverview = (tenantId?: string) =>
  req<OrgOverview>(`/tenant-admin/org-overview${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`);

// 改成員角色（tenant_admin 可用）· 伺服器限 員工↔部門主管（0055）· 與凍結的 custom-roles assignUserRole 不同端點
export const assignMemberRole = (userId: string, payload: { tenantId: string; role: "employee" | "group_owner" }) =>
  req<{ user: TenantUserDto }>(`/tenant-admin/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify(payload),
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

export const getMyPermissions = async () => {
  const res = await req<{ permissions: string[]; displayName?: string | null; locale?: string }>("/me/permissions");
  // 登入 / identity 變時會呼叫 → 順便把顯示名稱同步進 localStorage（topbar 用）· 變了才通知避免多餘 render
  if ((res.displayName || null) !== (localStorage.getItem(DISPLAY_KEY) || null)) {
    setLocalDisplayName(res.displayName || null);
  }
  // 0071 · 套用這個人存在伺服器的語言偏好 —— localStorage 只在本機，換裝置就沒了
  if (res.locale === "zh-TW" || res.locale === "en") setLocale(res.locale);
  return res;
};

/**
 * 自服務改介面語言 · 寫回伺服器讓它跨裝置。
 *
 * ⚠️ 呼叫端**不要 await 它才切畫面** —— 語言是即時的本機狀態，
 *    寫回失敗（離線、401）不該讓使用者切不動。失敗就只在這台機器生效。
 */
export const updateMyLocale = (locale: "zh-TW" | "en") =>
  req<{ locale: string }>("/auth/locale", { method: "POST", body: JSON.stringify({ locale }) });

// 自服務改顯示名稱（含 LINE 登入用戶）· 成功後同步 topbar
export const updateMyDisplayName = async (displayName: string) => {
  const res = await req<{ displayName: string }>("/auth/display-name", {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
  setLocalDisplayName(res.displayName);
  return res;
};
// === 租戶自管角色權限 · docs/modules/tenant-role-permissions.md ===
// 與上面的 /permissions、/roles 是**兩套**：那兩支是 aiproot 的（64 項、6 個角色），
// 這幾支是租戶的（26 項、3 個角色）。差異由後端決定，前端只是呼叫不同端點。

export interface TenantPermissionDto {
  permissionId: string;
  description: string;
  scope: string;   // 'tenant' | 'department'
}
export interface TenantRoleDto {
  roleKey: string;
  roleName: string;
  permissions: string[];
  /** 已由本公司調整過，不再跟隨系統預設 */
  isCustomized: boolean;
  /** 使用這個角色的人數 · 用來算「移除權限會影響幾個人」 */
  memberCount: number;
}

export const listTenantPermissions = () =>
  req<{ permissions: TenantPermissionDto[] }>("/tenant-roles/permissions");

export const listTenantRoles = () =>
  req<{ roles: TenantRoleDto[] }>("/tenant-roles");

export const updateTenantRolePermissions = (roleKey: string, permissionIds: string[]) =>
  req<{ forked: boolean; count: number }>(`/tenant-roles/${encodeURIComponent(roleKey)}/permissions`, {
    method: "PATCH",
    body: JSON.stringify({ permissionIds }),
  });

export const resetTenantRole = (roleKey: string) =>
  req<{ restored: boolean }>(`/tenant-roles/${encodeURIComponent(roleKey)}/reset`, {
    method: "POST",
  });

// ── 租戶自建角色 · docs/modules/custom-roles.md v0.3（方案 A）────────────────
// 跟上面那組的分工：上面是「改內建角色的權限」，這組是「建立／指派新角色」。
export interface CustomRoleDto {
  roleId: string;
  roleKey: string;
  roleName: string;
  /** 資料範圍基準：employee / group_owner / tenant_admin · 建立後不可改 */
  baselineRole: string;
  permissions: string[];
  memberCount: number;
}
export interface BaselineDto {
  id: string;
  label: string;
  hint: string;
}

export const listCustomRoles = () =>
  req<{ roles: CustomRoleDto[] }>("/tenant-custom-roles");

/** 三個資料範圍的文案由後端給 · 前端不自己編一套（兩邊會漂移） */
export const listBaselines = () =>
  req<{ baselines: BaselineDto[] }>("/tenant-custom-roles/baselines");

/** 沒有 roleKey —— 那是程式用的識別字，後端自動產生，使用者看不到也不用填 */
export const createCustomRole = (args: {
  roleName: string;
  baselineRole: string;
  permissionIds: string[];
}) =>
  req<{ roleId: string; roleKey: string }>("/tenant-custom-roles", {
    method: "POST",
    body: JSON.stringify(args),
  });

/** roleId = null 代表取消自訂角色，退回基準角色 */
export const assignCustomRole = (userId: string, roleId: string | null) =>
  req<{ role: string }>(`/tenant-custom-roles/assignments/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify({ roleId }),
  });

export const updateCustomRolePermissions = (roleId: string, permissionIds: string[]) =>
  req<{ count: number }>(`/tenant-custom-roles/${encodeURIComponent(roleId)}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ permissionIds }),
  });

export const deleteCustomRole = (roleId: string) =>
  req<{ ok: true }>(`/tenant-custom-roles/${encodeURIComponent(roleId)}`, { method: "DELETE" });

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
/**
 * ⚠️ 顯示狀態一律用 `analysisState`，**不要用 `status`**。
 * `status` 是「訊息收齊、分析已排入」不是分析結果 —— prod 50 筆全是 `completed`，
 * 其中 6 筆分析其實沒完成（docs/modules/batch-status-reconciliation.md）。
 */
export type AnalysisState =
  | "analyzed" | "analysis_failed" | "analyzing" | "stuck"
  | "no_result" | "collect_failed" | "empty" | "queued";

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
  analysisState: AnalysisState;
  uploadStatus: string | null;
  analysisError: string | null;
  /** 要人看一眼嗎 · **後端算的**（前端不維護第二份狀態集合，避免新增狀態時漂移）*/
  needsAttention: boolean;
}

export const listAnalysisBatches = (tenantId?: string) => {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  return req<{ batches: AnalysisBatchRow[] }>(`/aiproot-console/batches${qs}`);
};

export const rerunAnalysisBatch = (body: { tenantId: string; groupId: string; batchDate: string }) =>
  req<{
    batchId: string;
    /** ⚠️ 這是**批次**的狀態不是分析的 · completed = 訊息收齊、分析已排入 */
    status: string;
    /** 分析工作的去向 · queued = 在背景跑，**還沒有結果** */
    analysis: "queued" | "none" | "already_done";
    uploadId: number | null;
    messageCount: number;
  }>(
    "/aiproot-console/batches/rerun", { method: "POST", body: JSON.stringify(body) },
  );

/** 補跑個人日報 · 只補空缺，不重跑已存在的 */
export const runPendingPersonalReports = (opts: { lookbackDays?: number; tenantId?: string }) =>
  req<{ scanned: number; generated: number; empty: number; failed: number; alreadyHad: number }>(
    "/personal-daily-report/aiproot/run-pending",
    { method: "POST", body: JSON.stringify(opts) },
  );

export const runPendingBatches = (opts?: { lookbackDays?: number; tenantId?: string }) =>
  req<{ total: number; completed: number; empty: number; failed: number }>(
    "/aiproot-console/batches/run-pending",
    { method: "POST", body: JSON.stringify(opts ?? {}) },
  );

// aiproot 通用 · 列所有租戶（下拉篩選用）
export interface AiprootTenantOption {
  extractionTemplate?: string;
  tenantId: string;
  tenantName: string;
  batchEnabled: boolean;
}
export const listAiprootTenants = () =>
  req<{ tenants: AiprootTenantOption[] }>("/aiproot-console/tenants");

// ai-analysis-layering · L2 業種模板
export interface ExtractionTemplateOption { key: string; label: string; description: string }
export const listExtractionTemplates = () =>
  req<{ templates: ExtractionTemplateOption[] }>("/aiproot-console/tenants/extraction-templates");
export const setExtractionTemplate = (tenantId: string, template: string) =>
  req<{ tenantId: string; template: string; label: string }>(
    `/aiproot-console/tenants/${tenantId}/extraction-template`,
    { method: "PATCH", body: JSON.stringify({ template }) },
  );

// 抽取健康度 · 模板選對了嗎（doc ai-analysis-layering §5）
export interface FieldFill { field: string; layer: "L1" | "L2"; filled: number; total: number; rate: number }
export interface TenantHealth {
  tenantId: string; tenantName: string; template: string; templateLabel: string;
  messageCount: number; recordCount: number; templateReportCount: number;
  confidence: { high: number; medium: number; low: number };
  fields: FieldFill[]; warnings: string[];
}
export const getExtractionHealth = (days: number) =>
  req<{ days: number; tenants: TenantHealth[] }>(`/aiproot-console/extraction-health?days=${days}`);

// 租戶管理 · 某租戶的登入帳號一覽（救援用 · 不回密碼）
export interface TenantUserRow {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  departmentName: string | null;
  mustChangePassword: boolean;
  locked: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  failedLoginCount: number;
  passwordUpdatedAt: string | null;
}
export const listTenantLoginAccounts = (tenantId: string) =>
  req<{ users: TenantUserRow[] }>(`/aiproot-console/tenants/${tenantId}/users`);

// convo-analysis-realtime · aiproot 切 tenant 是否啟用 cron batch
export const setTenantBatchEnabled = (tenantId: string, enabled: boolean) =>
  req<{ tenantId: string; batchEnabled: boolean }>(
    `/aiproot-console/tenants/${tenantId}/batch-enabled`,
    { method: "PATCH", body: JSON.stringify({ enabled }) },
  );

// employee-line-binding · aiproot audit + nudge
// 成員的群組活動（group-type-classification.md §4.6）· 成員頁顯示「所屬部門是怎麼推出來的」
// 只含已綁定的人 —— 沒帳號的群成員不在這裡（那是另一個決定 OQ-GTC-13）
export interface MemberGroupActivity {
  groupName: string;
  groupType: string;
  messageCount: number;
  /** 只有部門群且有分派部門的才算進部門判定 */
  countsTowardDepartment: boolean;
}
export const listMemberGroupActivity = (tenantId?: string) =>
  req<{ activity: Record<string, MemberGroupActivity[]> }>(
    `/tenant-admin/users/group-activity${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`);

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
/** 永久刪除已撤銷的綁定紀錄 · 後端只放行 status='revoked' */
export const deleteBindingAiproot = (bindingId: string) =>
  req<{ success: boolean }>(`/binding/aiproot/${bindingId}`, { method: "DELETE" });

export interface UnboundStats {
  tenantId: string;
  tenantName: string;
  unboundCount: number;
  top: Array<{ senderLineId: string; displayName: string | null; messageCount: number; topGroupName: string | null }>;
}
export const getUnboundStats = () =>
  req<{ stats: UnboundStats[] }>("/binding/aiproot/unbound-stats");

// employee-line-binding · tenant_admin 自租戶自治（tenantId 由 backend 自 JWT 取 · 前端不傳）
export const listTenantBindingAudit = (status?: "active" | "revoked") => {
  const qs = status ? `?status=${status}` : "";
  return req<{ bindings: BindingAuditRow[] }>(`/binding/tenant/list${qs}`);
};
export const revokeBindingTenant = (bindingId: string) =>
  req<{ success: boolean }>(`/binding/tenant/revoke/${bindingId}`, { method: "POST", body: "{}" });
/** 永久刪除已撤銷的綁定紀錄 · 後端只放行 status='revoked' */
export const deleteBindingTenant = (bindingId: string) =>
  req<{ success: boolean }>(`/binding/tenant/${bindingId}`, { method: "DELETE" });
export const getTenantUnboundStats = () =>
  req<{ stats: UnboundStats }>("/binding/tenant/unbound-stats");

// ============================================================
// scheduler-config · 平台化定時任務
// ============================================================
export type SchedulerId = "pdr" | "group_batch";
// ── 任務設定（navigation-and-capability-gating M2/M5）──────────────
export interface TaskConfig {
  graceDays: number;
  tierDays: [number, number];
  /** 指派後要不要私訊當事人 */
  assignNotify: boolean;
  /** true = 這家還沒動過，用的是平台預設 */
  isDefault: boolean;
  template: { key: string; label: string; description: string } | null;
}

export const getTaskConfig = (tenantId?: string) =>
  req<TaskConfig>(`/task-config${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`);

export const updateTaskTiming = (body: { tenantId?: string; graceDays: number; tierDays: [number, number]; assignNotify?: boolean }) =>
  req<{ graceDays: number; tierDays: [number, number]; affectedTickets: number }>(
    "/task-config/timing", { method: "PATCH", body: JSON.stringify(body) });

export interface SchedulerConfigRow {
  schedulerId: SchedulerId;
  tenantId: string | null;
  enabled: boolean;
  cronExpr: string;
  timeZone: string;
  minSourceCount: number;
  lookbackDays: number;
  concurrency: number;
  lastRunAt: string | null;
  nextRunAt?: string | null;      // 後端依 cron 算出的下次觸發時間（停用/cron 壞 → null）
  lastRunResult: Record<string, unknown> | null;
  updatedBy: string | null;
  updatedAt: string;
}

// tenantId：平台角色指定要看哪一家的設定 · 不傳＝只看平台預設
export const listSchedulerConfigs = (tenantId?: string) =>
  req<{ configs: SchedulerConfigRow[] }>(`/scheduler-config${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`);

export const upsertSchedulerConfig = (args: {
  schedulerId: SchedulerId;
  tenantId?: string | null;
  enabled: boolean;
  cronExpr: string;
  timeZone: string;
  minSourceCount: number;
  lookbackDays: number;
  concurrency: number;
}) =>
  req<{ config: SchedulerConfigRow }>("/scheduler-config", {
    method: "POST",
    body: JSON.stringify(args),
  });

export const triggerWarroomBatchRerun = () =>
  req<{ total: number; completed: number; empty: number; failed: number }>("/warroom/batches/rerun", {
    method: "POST",
    body: "{}",
  });

// 群組原始訊息 (今日日誌 · 展開群卡看 bot 收到什麼)
export interface WarroomGroupMessage {
  messageId: string;
  senderName: string | null;
  senderLineId: string | null;
  messageType: string;
  textContent: string | null;
  sentAt: string;
}
export const getWarroomGroupMessages = (groupId: string, date: string) =>
  req<{ messages: WarroomGroupMessage[]; total: number }>(
    `/warroom/group-messages?groupId=${encodeURIComponent(groupId)}&date=${encodeURIComponent(date)}`,
  );

// LINE 群組 · tenant_admin 頁 (自 tenant 全群列表 + 分派部門)
// (patchLineGroup 已定義在上方 · aiproot / tenant_admin 共用)
export const listTenantLineGroups = (tenantId?: string) =>
  req<{ groups: LineGroupRow[] }>(
    `/line-groups${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`);

// 素材看板 · docs/modules/media-and-vision.md §2
export type MediaKind = "image" | "video" | "audio" | "file";
export interface MediaItem {
  mediaId: string;
  kind: MediaKind;
  contentType: string | null;
  sizeBytes: number | null;
  filename: string | null;
  caption: string | null;
  groupName: string | null;
  departmentName: string | null;
  senderName: string | null;
  sentAt: string;
  daysLeft?: number;
  deletedByName?: string | null;
}
export interface MediaGroupOption { groupId: string; name: string }
export interface MediaListResult {
  items: MediaItem[];
  total: number;
  counts: Record<MediaKind | "all", number>;
  /** 有檔案的群 · 給篩選下拉用 */
  groups: MediaGroupOption[];
  page: number;
  pageSize: number;
}
/** 日期是台灣時間的 YYYY-MM-DD · groupId 是 LINE 的 Cxxx… */
export interface MediaFilters { from?: string; to?: string; groupId?: string; q?: string }
export const listMedia = (
  kind: MediaKind | "all", page: number, deleted = false, f: MediaFilters = {},
) => {
  const q = new URLSearchParams({ page: String(page) });
  if (kind !== "all") q.set("kind", kind);
  if (deleted) q.set("deleted", "true");
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (f.groupId) q.set("groupId", f.groupId);
  if (f.q) q.set("q", f.q);
  return req<MediaListResult>(`/media?${q}`);
};

export const deleteMedia = (mediaId: string, reason?: string) =>
  req<{ daysLeft: number }>(`/media/${mediaId}`, {
    method: "DELETE",
    body: JSON.stringify({ reason: reason ?? "" }),
  });

export const restoreMedia = (mediaId: string) =>
  req<{ success: boolean }>(`/media/${mediaId}/restore`, { method: "POST", body: "{}" });

/** 立即徹底清除 · 僅平台端可用 */
export const purgeMedia = (mediaId: string) =>
  req<{ success: boolean }>(`/media/${mediaId}/purge`, { method: "POST", body: "{}" });

/**
 * 取檔案內容轉成 blob 網址給 <img> / <video> 用。
 * 為什麼不直接把網址塞進 src：檔案要帶 JWT 才拿得到，而 <img> 送不出 Authorization header。
 * 這也順便讓 R2 的網址完全不進瀏覽器（media-and-vision.md FMEA F-2）。
 * 回傳的網址用完要 URL.revokeObjectURL，否則整包檔案會留在記憶體裡。
 */
export async function fetchMediaBlobUrl(mediaId: string): Promise<string> {
  const url = `${API_BASE ? API_BASE : "/api"}/media/${encodeURIComponent(mediaId)}/content`;
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, friendlyStatusMessage(res.status));
  return URL.createObjectURL(await res.blob());
}

/**
 * 下載素材檔案。
 *
 * ⚠️ 為什麼是 blob 而不是 `<a href>`：檔案要帶 JWT 才拿得到，而純連結送不出
 * Authorization header —— 直接連過去會 401。同 fetchMediaBlobUrl 的理由。
 * 拿到 blob 之後用同源的 object URL，`download` 屬性才會生效
 * （跨來源時瀏覽器會忽略它，變成開新分頁、沒下載到東西）。
 */
export async function downloadMedia(mediaId: string, filename: string | null): Promise<void> {
  const url = `${API_BASE ? API_BASE : "/api"}/media/${encodeURIComponent(mediaId)}/content`;
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, friendlyStatusMessage(res.status));
  const objUrl = URL.createObjectURL(await res.blob());
  try {
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename || `media-${mediaId}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // 不 revoke 的話整包檔案會留在記憶體裡
    URL.revokeObjectURL(objUrl);
  }
}

// 稽核記錄 · 讀 audit_log（原本這頁是編造的事件）
export interface AuditItem {
  id: string;
  at: string;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  isWrite: boolean;
  result: string;
}
export type AuditScope = "all" | "write" | "login";
export const listAudit = (scope: AuditScope, page: number) =>
  req<{ items: AuditItem[]; page: number; pageSize: number; hasNext: boolean }>(
    `/audit?scope=${scope}&page=${page}`,
  );

// ── 任務追蹤到結束 · task-completion-tracking.md ────────────────────
// ⚠️ 網頁是**補登**路徑 · 主要入口是 LINE 引用回覆（當責人多半沒有系統帳號）

export type WorkOutcome = "完成" | "不用做了" | "轉他人" | "做不到";

/** 補登結束 · 代結的話後端會記下是誰按的，看板會顯示「由 ○○ 代為結束」 */
export const closeTicketWork = (ticketId: string, outcome: WorkOutcome, note?: string) =>
  req<{ ticketId: string; workStatus: string; workOutcome: string }>(
    `/warroom/tickets/${ticketId}/work-close`,
    { method: "PATCH", body: JSON.stringify({ outcome, note }) },
  );

/** 還原成「尚未確認完成」· 標錯了要有補救途徑，否則沒人敢按 */
export const reopenTicketWork = (ticketId: string) =>
  req<{ ticketId: string; workStatus: string }>(
    `/warroom/tickets/${ticketId}/work-reopen`, { method: "PATCH" },
  );

/** 回報進度 · 低承諾動作 · 任務留在進行中 */
export const reportTicketWork = (ticketId: string, note: string) =>
  req<{ ticketId: string }>(
    `/warroom/tickets/${ticketId}/work-report`,
    { method: "PATCH", body: JSON.stringify({ note }) },
  );

export interface UnresolvedSignal {
  signalId: string; intent: string; note: string | null; receivedAt: string;
  replier: string | null; quotedText: string | null; groupName: string | null;
  reason: "materialization_gap" | "awaiting_batch";
  reasonLabel: string;
}

/** 未接住清單 · 平台管理員的除錯與校準訊號，不是客戶的待辦 */
export const getUnresolvedSignals = (tenantId: string) =>
  req<{ items: UnresolvedSignal[]; counts: { awaitingBatch: number; materializationGap: number; ticketGone: number } }>(
    `/completion-signals/unresolved?tenantId=${encodeURIComponent(tenantId)}`,
  );

export interface CompletionStats {
  windowDays: number;
  signals: {
    total: number; completion: number; caught: number;
    /** 真的把任務關掉的 · 跟「接住」不同（進度回報也算接住） */
    closedByReply: number;
    /** 標籤說接住了，但掛到的任務已被刪除 */
    ticketGone: number;
    materializationGap: number; awaitingBatch: number; catchRate: number | null;
  };
  tickets: {
    done: number; dropped: number; otherClosed: number; open: number;
    closeRate: number | null; formula: string;
  };
}

/** 接住率要先看 · 收到 20 則只對上 3 張的話，問題在鏈不在人 */
export const getCompletionStats = (tenantId: string, days = 14) =>
  req<CompletionStats>(
    `/completion-signals/stats?tenantId=${encodeURIComponent(tenantId)}&days=${days}`,
  );

/** 待確認的任務 · 收為任務（accept=true）或不用追（false）· task-materialization-gate.md */
export const decideTicket = (ticketId: string, accept: boolean) =>
  req<{ ticketId: string; confirmStatus: string }>(`/warroom/tickets/${ticketId}/decision`, {
    method: "PATCH",
    body: JSON.stringify({ accept }),
  });

/** 本月外勤摘要 · 只回自己的（four-features-reflection §7 價值對等） */
export interface MyMonthSummary {
  trips: number;
  outDays: number;
  km: number;
  topPlace: string | null;
  topPlaceCount: number;
}
export const getMyMonthAttendance = () => req<MyMonthSummary>("/attendance/my-month");

/** 地點候選 · 自己去過的地方（four-features-reflection §4 · P3） */
export interface PlaceSuggestion { name: string; times: number; lastAt: string | null; fromMaster?: boolean }
export const getPlaceSuggestions = (q: string) =>
  req<{ places: PlaceSuggestion[] }>(`/attendance/places?q=${encodeURIComponent(q)}`);

// 主檔（客戶名冊）· docs/modules/master-data-sync.md
export interface MasterDataSource {
  sourceId: string;
  provider: "ragic" | "manual";
  accountId: string | null;
  sheetPath: string | null;
  nameField: string | null;
  codeField: string | null;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncCount: number | null;
  lastSyncError: string | null;
}
export interface MasterDataState {
  source: MasterDataSource | null;
  customerCount: number;
  ragicAccounts: Array<{ accountId: string; displayName: string; apname: string; hasKey: boolean }>;
}
export const getMasterDataSource = (tenantId?: string) =>
  req<MasterDataState>(`/master-data/source${tenantId ? `?tenantId=${tenantId}` : ""}`);
export const saveMasterDataSource = (body: {
  tenantId?: string; provider: "ragic" | "manual"; accountId?: string | null;
  sheetPath?: string | null; nameField?: string | null; codeField?: string | null;
}) => req<{ success: boolean }>("/master-data/source", { method: "POST", body: JSON.stringify(body) });
export const syncMasterData = (tenantId?: string) =>
  req<{ count: number }>("/master-data/sync", { method: "POST", body: JSON.stringify({ tenantId }) });
