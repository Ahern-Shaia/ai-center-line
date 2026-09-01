import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { db, withAuthLookup } from "../db/client.js";
import type { Role } from "../db/schema.js";
import { hasKey, msg } from "../i18n/index.js";
import { currentTx } from "../db/client.js";

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

    // 有效角色的優先序：role_id → **該租戶自行調整過的副本** → 內建
    // 走 withAuthLookup 繞 users RLS · 因 PermissionGuard 在 TenantTxInterceptor 之前 · 無 session context
    //
    // ⚠️⚠️ 2026-09-01 用戶回報「配置權限沒生效」的**真正根因**就在這裡。
    //    舊版只有 `COALESCE(u.role_id, 內建角色)` —— 少了中間那層。
    //
    //    租戶在「權限管理」改內建角色時，後端會 fork 出一份租戶版
    //    （tenant-roles.service），並把**當下已存在**的成員 role_id 指過去。
    //    但那個 UPDATE 只跑那一次 —— **之後才建立的帳號 role_id 是 NULL**，
    //    於是這裡的 fallback 抓到 `is_system = true` 的內建角色，
    //    租戶的調整完全被忽略。
    //
    //    而 LINE 綁定自動建立的員工帳號**從來不寫 role_id**
    //    （employee-binding.service 的 INSERT 沒有這一欄）——
    //    所以「先調權限、之後才綁 LINE 的人」100% 踩到。
    //
    //    實測（本機造資料）：租戶設定 6 項，該員工實際只拿到 2 項
    //    （personal-report:mine / trips:mine ＝內建員工角色）。
    //
    // ⭐ 加中間這層之後**回溯生效**，不用 migration、不用叫使用者重新綁定。
    // ⚠️ 平台帳號的 u.tenant_id 是 NULL → 中間那層永遠查不到 → 照樣落到內建，行為不變。
    // ⚠️ 這個優先序 tenant-roles.service 的 listRoles（`picked` CTE，
    //    「有副本就用副本」）本來就是這樣寫的 —— 是這支沒跟上。
    const res = await withAuthLookup((tx) =>
      tx.execute<{ permission_id: string }>(sql`
        SELECT DISTINCT rp.permission_id
        FROM users u
        LEFT JOIN role_permissions rp ON rp.role_id = COALESCE(
          u.role_id,
          (SELECT r.role_id FROM roles r
            WHERE r.role_key = u.role AND r.tenant_id = u.tenant_id LIMIT 1),
          (SELECT r.role_id FROM roles r
            WHERE r.role_key = u.role AND r.is_system = true LIMIT 1)
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

  /**
   * 這個人所屬公司的名稱（左上角品牌用）。
   *
   * ⚠️⚠️ 2026-09-01 之前，前端是**硬編一張 tenant_id → 名稱的對照表**
   *    （Shell.tsx 的 TENANT_NAME，只有 aiproot 與台灣福祉兩筆），
   *    對不到就顯示佔位字「客戶方」。
   *    結果排查「權限沒生效」時，我把那個佔位字當成真的租戶名，
   *    據此判斷「這是另一家客戶」——**判斷錯誤，浪費了一輪**。
   *
   * ⭐ 放在這個端點而不是 JWT：
   *    · 不用重新登入就生效（JWT 要等舊 token 過期）
   *    · 租戶改名會即時反映（JWT 裡的名字會過時）
   *
   * ⚠️⚠️ 這支**不可以**用 withAuthLookup（我第一版就寫錯了）。
   *    withAuthLookup 只設 `app.auth_lookup='1'`，而那是給 `users` 的
   *    `p_users_auth` policy 用的 —— **`tenants` 沒有對應的 policy**
   *    （它要 app.current_tenant 或 app.actor_role 或 app_is_platform_ops）。
   *    所以 LEFT JOIN 到 tenants 會靜默拿不到列 → tenant_name 永遠 null，
   *    而且**不會報錯**（memory: rls-silent-zero）。
   *
   *    改用 currentTx()：這支只從 controller 呼叫，而 controller 跑在
   *    TenantTxInterceptor 之後，租戶上下文已經設好了
   *    （memory: currenttx-vs-systemtx —— 「90% controller 內用 currentTx()」）。
   *    平台帳號 tenant_id 是 NULL，走 policy 的 actor_role 那一支，照樣讀得到。
   */
  async getTenantName(): Promise<string | null> {
    const res = await currentTx().execute<{ tenant_name: string | null }>(sql`
      SELECT tenant_name FROM tenants
      WHERE tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
      LIMIT 1
    `);
    return res.rows[0]?.tenant_name ?? null;
  }

  /** 0071 · 介面語言 · 讀不到一律回 zh-TW（新帳號/舊資料都有 DEFAULT，這只是保險） */
  async getLocale(userId: string): Promise<string> {
    const res = await withAuthLookup((tx) =>
      tx.execute<{ locale: string }>(sql`SELECT locale FROM users WHERE user_id = ${userId} LIMIT 1`));
    return res.rows[0]?.locale ?? "zh-TW";
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
      // ⚠️ DB 的 description 是**中文原文**（seed 寫進去的）。這裡優先用字典的
      //    `srv.permdesc.<permission_id>`，查不到才回 DB 原文 —— 新增權限忘了補字典時
      //    畫面上仍是看得懂的中文，而不是 `srv.permdesc.xxx:yyy`（M4b）。
      description: hasKey(`srv.permdesc.${r.permission_id}`) ? msg(`srv.permdesc.${r.permission_id}`) : r.description,
      scope: r.scope,
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
