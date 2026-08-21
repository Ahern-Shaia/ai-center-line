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
  /** MDA · 'auto'=系統推導 / 'manual'=有人手動指派 · 前端據此標來源 */
  departmentSource: "auto" | "manual";
  email: string | null;
  displayName: string | null;
  lineUserId: string | null;
  createdAt: string;
  hasPassword: boolean;
  roleId?: string | null;
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
      user_id: string; tenant_id: string | null; role: Role; role_id: string | null;
      department_id: string | null; department_name: string | null;
      department_source: "auto" | "manual";
      email: string | null; display_name: string | null;
      line_user_id: string | null; created_at: string;
      has_password: boolean;
    }>(sql`
      SELECT u.user_id, u.tenant_id, u.role, u.role_id::text, u.department_id, d.department_name,
             u.department_source,
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
      user_id: string; tenant_id: string | null; role: Role; role_id: string | null;
      department_id: string | null; department_name: string | null;
      department_source: "auto" | "manual";
      email: string | null; display_name: string | null;
      line_user_id: string | null; created_at: string; has_password: boolean;
    }>(sql`
      SELECT u.user_id, u.tenant_id, u.role, u.role_id::text, u.department_id, d.department_name,
             u.department_source,
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

  /**
   * 這個人被幾張任務「留下姓名」。
   *
   * tickets 的 confirmed_by / assigned_by / proxy_by 三個外鍵都是 ON DELETE NO ACTION，
   * 有引用就刪不掉人。不先算就直接刪，使用者會收到一坨 Postgres 的
   * `tickets_confirmed_by_fkey` 錯誤 —— 既看不懂，也不知道下一步該做什麼。
   *
   * ⚠️ 走 RLS 上下文（呼叫端已 setTenantContext），只看得到該租戶的任務。
   *    跨租戶引用理論上不該存在，真有的話由 service 的 FK catch 兜底。
   */
  async countTicketReferences(tx: Db, userId: string): Promise<number> {
    const res = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM tickets
      WHERE confirmed_by = ${userId} OR assigned_by = ${userId} OR proxy_by = ${userId}
    `);
    return res.rows[0]?.n ?? 0;
  }

  /**
   * MDA · 手動指派部門 —— 只改部門 + 標記來源，**不碰 role/password**。
   * ⚠️ 目標部門必須屬同一租戶（防跨租戶 IDOR）· 由呼叫端在 RLS 上下文內先驗（service）。
   * ⚠️ 標 department_source='manual' → 自動推導日後不得覆寫（Okta/Azure 手動優先）。
   */
  async assignDepartment(tx: Db, args: {
    userId: string;
    departmentId: string | null;
    actorUserId: string;
  }): Promise<void> {
    await tx.execute(sql`
      UPDATE users SET
        department_id = ${args.departmentId},
        department_source = 'manual',
        department_assigned_by = ${args.actorUserId}::uuid,
        department_assigned_at = now()
      WHERE user_id = ${args.userId}
    `);
  }

  /** 該部門是否屬這個租戶（RLS 之外再明擋一層 · 防 IDOR）*/
  async departmentBelongsToTenant(tx: Db, departmentId: string, tenantId: string): Promise<boolean> {
    const res = await tx.execute<{ ok: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM departments WHERE department_id = ${departmentId}::uuid AND tenant_id = ${tenantId}::uuid
      ) AS ok
    `);
    return res.rows[0]?.ok ?? false;
  }

  private rowToDto(r: {
    user_id: string; tenant_id: string | null; role: Role; role_id: string | null;
    department_id: string | null; department_name: string | null;
    department_source: "auto" | "manual";
    email: string | null; display_name: string | null;
    line_user_id: string | null; created_at: string; has_password: boolean;
  }): UserRow {
    return {
      userId: r.user_id,
      tenantId: r.tenant_id,
      role: r.role,
      // 自訂角色指到的 role_id · null ＝ 用內建角色（custom-roles v0.3）
      roleId: r.role_id,
      departmentId: r.department_id,
      departmentName: r.department_name,
      departmentSource: r.department_source,
      email: r.email,
      displayName: r.display_name,
      lineUserId: r.line_user_id,
      createdAt: r.created_at,
      hasPassword: r.has_password,
    };
  }
}
