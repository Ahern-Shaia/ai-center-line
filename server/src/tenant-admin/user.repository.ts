import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { Role } from "../db/schema.js";

export interface UserRow {
  userId: string;
  tenantId: string | null;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
  email: string | null;
  displayName: string | null;
  lineUserId: string | null;
  createdAt: string;
  hasPassword: boolean;
}

export interface UserInsertInput {
  tenantId: string;
  role: Role;
  email: string;
  displayName?: string;
  departmentId?: string | null;
  passwordHash: string;
}

@Injectable()
export class UserRepository {
  async setTenantContext(tx: Db, tenantId: string): Promise<void> {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
  }

  async listByTenant(tx: Db, tenantId: string): Promise<UserRow[]> {
    // 明確 filter tenant_id · 避免 aiproot_admin role bypass 意外看到其他 tenant 或平台方 users
    const res = await tx.execute<{
      user_id: string; tenant_id: string | null; role: Role;
      department_id: string | null; department_name: string | null;
      email: string | null; display_name: string | null;
      line_user_id: string | null; created_at: string;
      has_password: boolean;
    }>(sql`
      SELECT u.user_id, u.tenant_id, u.role, u.department_id, d.department_name,
             u.email, u.display_name, u.line_user_id, u.created_at::text,
             (u.password_hash IS NOT NULL) AS has_password
      FROM users u
      LEFT JOIN departments d ON d.department_id = u.department_id
      WHERE u.tenant_id = ${tenantId}
      ORDER BY u.role, u.display_name NULLS LAST, u.email NULLS LAST
    `);
    return res.rows.map((r) => this.rowToDto(r));
  }

  async getById(tx: Db, userId: string): Promise<UserRow | null> {
    const res = await tx.execute<{
      user_id: string; tenant_id: string | null; role: Role;
      department_id: string | null; department_name: string | null;
      email: string | null; display_name: string | null;
      line_user_id: string | null; created_at: string; has_password: boolean;
    }>(sql`
      SELECT u.user_id, u.tenant_id, u.role, u.department_id, d.department_name,
             u.email, u.display_name, u.line_user_id, u.created_at::text,
             (u.password_hash IS NOT NULL) AS has_password
      FROM users u
      LEFT JOIN departments d ON d.department_id = u.department_id
      WHERE u.user_id = ${userId}
      LIMIT 1
    `);
    const r = res.rows[0];
    if (!r) return null;
    return this.rowToDto(r);
  }

  async insert(tx: Db, input: UserInsertInput): Promise<string> {
    const res = await tx.execute<{ user_id: string }>(sql`
      INSERT INTO users (tenant_id, role, email, display_name, department_id, password_hash)
      VALUES (${input.tenantId}, ${input.role}, ${input.email},
              ${input.displayName ?? null}, ${input.departmentId ?? null}, ${input.passwordHash})
      RETURNING user_id
    `);
    const row = res.rows[0];
    if (!row) throw new Error("insert user 未回 user_id");
    return row.user_id;
  }

  async update(tx: Db, userId: string, patch: {
    role?: Role;
    displayName?: string | null;
    departmentId?: string | null;
    passwordHash?: string;
  }): Promise<void> {
    await tx.execute(sql`
      UPDATE users SET
        role = COALESCE(${patch.role ?? null}, role),
        display_name = CASE WHEN ${patch.displayName !== undefined}::boolean
          THEN ${patch.displayName ?? null} ELSE display_name END,
        department_id = CASE WHEN ${patch.departmentId !== undefined}::boolean
          THEN ${patch.departmentId ?? null} ELSE department_id END,
        password_hash = COALESCE(${patch.passwordHash ?? null}, password_hash)
      WHERE user_id = ${userId}
    `);
  }

  async delete(tx: Db, userId: string): Promise<void> {
    await tx.execute(sql`DELETE FROM users WHERE user_id = ${userId}`);
  }

  private rowToDto(r: {
    user_id: string; tenant_id: string | null; role: Role;
    department_id: string | null; department_name: string | null;
    email: string | null; display_name: string | null;
    line_user_id: string | null; created_at: string; has_password: boolean;
  }): UserRow {
    return {
      userId: r.user_id,
      tenantId: r.tenant_id,
      role: r.role,
      departmentId: r.department_id,
      departmentName: r.department_name,
      email: r.email,
      displayName: r.display_name,
      lineUserId: r.line_user_id,
      createdAt: r.created_at,
      hasPassword: r.has_password,
    };
  }
}
