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

let token: string | null = localStorage.getItem("token");
export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem("token", t);
  else localStorage.removeItem("token");
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
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<void> {
  const d = await req<{ access_token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(d.access_token);
}
export const getWarroom = () => req<Warroom>("/warroom");
export const getPending = () => req<{ pending: PendingTicket[] }>("/signoff");
export const confirmSignoff = (ticket_ids: string[]) =>
  req<ConfirmResult>("/signoff", { method: "POST", body: JSON.stringify({ ticket_ids }) });
