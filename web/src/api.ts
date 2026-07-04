// 後端 API client。dev 走 Vite proxy（/api → :3000）。

export interface WarroomGroup {
  department_id: string;
  name: string;
  ragic_table: string;
  health: "green" | "yellow" | "red";
  signed_off: boolean;
  today_total: number;
  high_count: number;
  has_low_pending: boolean;
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

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  if (res.status === 401 && path !== "/auth/login") {
    // 失效 token 清掉，讓上層決定要不要跳登入。
    logout();
    throw new ApiError(401, "工作階段已過期，請重新登入");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
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
