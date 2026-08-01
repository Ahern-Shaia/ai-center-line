import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { db, withAuthLookup } from "../db/client.js";
import type { Role } from "../db/schema.js";

// Permission engine · in-memory cache 5 min TTL (OQ-PE-5)
// 一個實例 · single-flight per user

interface UserPermCache {
  perms: Set<string>;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);
  private cache = new Map<string, UserPermCache>();

  async userHas(userId: string, permissionId: string): Promise<boolean> {
    const perms = await this.getUserPermissions(userId);
    return perms.has(permissionId);
  }

  async getUserPermissions(userId: string): Promise<Set<string>> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.perms;

    // 用 role_id · fallback role 字串 map 到 built-in
    // 走 withAuthLookup 繞 users RLS · 因 PermissionGuard 在 TenantTxInterceptor 之前 · 無 session context
    const res = await withAuthLookup((tx) =>
      tx.execute<{ permission_id: string }>(sql`
        SELECT DISTINCT rp.permission_id
        FROM users u
        LEFT JOIN role_permissions rp ON rp.role_id = COALESCE(
          u.role_id,
          (SELECT r.role_id FROM roles r WHERE r.role_key = u.role AND r.is_system = true LIMIT 1)
        )
        WHERE u.user_id = ${userId} AND rp.permission_id IS NOT NULL
      `)
    );
    const perms = new Set(res.rows.map((r) => r.permission_id));
    this.cache.set(userId, { perms, expiresAt: Date.now() + CACHE_TTL_MS });
    return perms;
  }

  // 目前使用者的顯示名稱（給 topbar 顯示）· 走 withAuthLookup 繞 users RLS（同 getUserPermissions）
  async getDisplayName(userId: string): Promise<string | null> {
    const res = await withAuthLookup((tx) =>
      tx.execute<{ display_name: string | null }>(sql`SELECT display_name FROM users WHERE user_id = ${userId} LIMIT 1`));
    return res.rows[0]?.display_name ?? null;
  }

  // Cache invalidation · 改 role_permissions 或 user.role_id 時呼叫
  invalidateUser(userId: string): void {
    this.cache.delete(userId);
  }
  invalidateAll(): void {
    this.cache.clear();
  }

  // 讀所有 permissions · UI 建 role 時用
  async listAllPermissions(): Promise<Array<{ permissionId: string; resource: string; action: string; description: string; scope: string }>> {
    const res = await db.execute<{
      permission_id: string; resource: string; action: string; description: string; scope: string;
    }>(sql`SELECT permission_id, resource, action, description, scope FROM permissions ORDER BY resource, action`);
    return res.rows.map((r) => ({
      permissionId: r.permission_id, resource: r.resource, action: r.action,
      description: r.description, scope: r.scope,
    }));
  }

  // 讀 roles · aiproot 看全 · tenant_admin 看 own tenant
  async listRoles(tenantId?: string | null): Promise<Array<{
    roleId: string; roleKey: string; roleName: string; isSystem: boolean;
    tenantId: string | null; permissions: string[];
  }>> {
    const whereClause = tenantId
      ? sql`WHERE r.tenant_id = ${tenantId} OR r.tenant_id IS NULL`
      : sql``;
    const res = await db.execute<{
      role_id: string; role_key: string; role_name: string;
      tenant_id: string | null; is_system: boolean;
      permission_ids: string[];
    }>(sql`
      SELECT r.role_id, r.role_key, r.role_name, r.tenant_id, r.is_system,
             COALESCE(ARRAY_AGG(rp.permission_id) FILTER (WHERE rp.permission_id IS NOT NULL), '{}') AS permission_ids
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.role_id
      ${whereClause}
      GROUP BY r.role_id
      ORDER BY r.is_system DESC, r.role_name
    `);
    return res.rows.map((r) => ({
      roleId: r.role_id, roleKey: r.role_key, roleName: r.role_name,
      tenantId: r.tenant_id, isSystem: r.is_system,
      permissions: r.permission_ids,
    }));
  }

  // ==================================================================
  // Phase 2 · Custom role UI backend
  // ==================================================================

  async createCustomRole(args: {
    roleKey: string;
    roleName: string;
    tenantId: string | null;
    permissionIds: string[];
  }): Promise<{ roleId: string }> {
    const res = await db.transaction(async (tx) => {
      const roleRes = await tx.execute<{ role_id: string }>(sql`
        INSERT INTO roles (role_key, role_name, tenant_id, is_system)
        VALUES (${args.roleKey}, ${args.roleName}, ${args.tenantId}, false)
        RETURNING role_id
      `);
      const roleId = roleRes.rows[0].role_id;
      if (args.permissionIds.length > 0) {
        const values = args.permissionIds.map((pid) => sql`(${roleId}::uuid, ${pid})`);
        await tx.execute(sql`
          INSERT INTO role_permissions (role_id, permission_id)
          VALUES ${sql.join(values, sql`, `)}
          ON CONFLICT DO NOTHING
        `);
      }
      return { roleId };
    });
    this.invalidateAll();
    return res;
  }

  async updateRolePermissions(roleId: string, permissionIds: string[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM role_permissions WHERE role_id = ${roleId}::uuid`);
      if (permissionIds.length > 0) {
        const values = permissionIds.map((pid) => sql`(${roleId}::uuid, ${pid})`);
        await tx.execute(sql`
          INSERT INTO role_permissions (role_id, permission_id)
          VALUES ${sql.join(values, sql`, `)}
        `);
      }
    });
    this.invalidateAll();
  }

  async renameRole(roleId: string, newName: string): Promise<void> {
    await db.execute(sql`
      UPDATE roles SET role_name = ${newName}, updated_at = now()
      WHERE role_id = ${roleId}::uuid AND is_system = false
    `);
  }

  async deleteRole(roleId: string): Promise<void> {
    const usage = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM users WHERE role_id = ${roleId}::uuid
    `);
    const n = parseInt(usage.rows[0].count, 10);
    if (n > 0) {
      throw new Error(`此 role 尚有 ${n} 個 user 使用 · 請先 reassign 才能刪除`);
    }
    const res = await db.execute(sql`
      DELETE FROM roles WHERE role_id = ${roleId}::uuid AND is_system = false
    `);
    if ((res.rowCount ?? 0) === 0) {
      throw new Error("此 role 不存在或為 system role (不可刪)");
    }
    this.invalidateAll();
  }

  async assignRoleToUser(userId: string, roleId: string): Promise<void> {
    await db.execute(sql`
      UPDATE users SET role_id = ${roleId}::uuid,
                       role = (SELECT role_key FROM roles WHERE role_id = ${roleId}::uuid)
      WHERE user_id = ${userId}::uuid
    `);
    this.invalidateUser(userId);
  }
}

// Fallback role → permissions map · 未有 DB 前的預設 (backup for @Roles delegation)
//
// ⚠️ 刻意用 `Record<Role, ...>` 而不是 `Partial<...>` —— 加內建角色時 tsc 會在這裡擋下來，
//    不會靜默漏掉一個。（0049 加 assistant 時就是被這裡抓到的。）
export const BUILTIN_ROLE_PERMISSIONS: Record<Role, string[]> = {
  aiproot_admin: [],  // 動態算 · 上面 service 讀 DB
  consultant: [],
  tenant_admin: [],
  group_owner: [],
  employee: [],
  assistant: [],
};
