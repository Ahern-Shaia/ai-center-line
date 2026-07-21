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
}

// Fallback role → permissions map · 未有 DB 前的預設 (backup for @Roles delegation)
export const BUILTIN_ROLE_PERMISSIONS: Record<Role, string[]> = {
  aiproot_admin: [],  // 動態算 · 上面 service 讀 DB
  consultant: [],
  tenant_admin: [],
  group_owner: [],
};
