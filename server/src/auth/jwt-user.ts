import type { Role } from "../db/schema.js";

// JWT payload（登入後夾帶的身分）。RLS 上下文由此推導。
export interface JwtUser {
  user_id: string;
  role: Role;
  tenant_id: string | null;
  department_id: string | null;
}
