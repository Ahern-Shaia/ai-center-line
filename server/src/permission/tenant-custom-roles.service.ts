import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";
import { PermissionService } from "./permission.service.js";

// 租戶自建角色 · docs/modules/custom-roles.md v0.3（方案 A）
//
// 跟 `tenant-roles.service.ts` 的分工：
//   tenant-roles         → 改**內建角色**的權限（fork-on-edit · 0067）
//   tenant-custom-roles  → 建立／指派／刪除**新角色**（本檔 · 0070）
// 拆開是因為前者已經 278 行，合起來會過 300 行紅線。
//
// 方案 A 的一句話：**自訂角色只宣告「能做什麼」，資料範圍沿用一個內建角色當基準。**
// 指派時 `users.role = 基準`（餵 35 條 RLS policy）、`users.role_id = 自訂角色`（餵 127 個端點）。

/** 可當資料範圍基準的內建角色 · 與 migration 0070 的 CHECK 必須一致 */
export const BASELINE_ROLES = ["employee", "group_owner", "tenant_admin"] as const;
export type BaselineRole = (typeof BASELINE_ROLES)[number];

/** 租戶看得到、也才勾得到的權限範圍（platform 那 33 項不回傳）· 與 0067 同一條線 */
const TENANT_VISIBLE_SCOPES = ["tenant", "department"] as const;

export interface CustomRoleItem {
  roleId: string;
  roleKey: string;
  roleName: string;
  baselineRole: string;
  permissions: string[];
  memberCount: number;
}

@Injectable()
export class TenantCustomRolesService {
  private readonly logger = new Logger(TenantCustomRolesService.name);

  constructor(private readonly perms: PermissionService) {}

  /** 這個租戶自己建的角色（不含 0067 fork 出來的內建角色副本） */
  async list(tenantId: string): Promise<CustomRoleItem[]> {
    const res = await currentTx().execute<{
      role_id: string; role_key: string; role_name: string;
      baseline_role: string; permission_ids: string[]; member_count: number;
    }>(sql`
      SELECT r.role_id::text, r.role_key, r.role_name,
             COALESCE(r.baseline_role, r.role_key) AS baseline_role,
             COALESCE(ARRAY_AGG(rp.permission_id) FILTER (WHERE rp.permission_id IS NOT NULL), '{}') AS permission_ids,
             (SELECT count(*)::int FROM users u WHERE u.role_id = r.role_id) AS member_count
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.role_id
      WHERE r.tenant_id = ${tenantId}::uuid
        AND r.is_system = false
        AND r.baseline_role IS NOT NULL   -- 有基準才是「新建的」· fork 的副本 baseline 為 NULL
      GROUP BY r.role_id
      ORDER BY r.role_name
    `);
    return res.rows.map((r) => ({
      roleId: r.role_id, roleKey: r.role_key, roleName: r.role_name,
      baselineRole: r.baseline_role, permissions: r.permission_ids, memberCount: r.member_count,
    }));
  }

  /**
   * 建立自訂角色。
   *
   * ⚠️⚠️ **防提權（V-1 · P0）**：送進來的權限必須是**呼叫者自己已經有的**。
   * 這是 K8s RBAC 的 `escalate` 紀律（custom-roles.md §3.2）——
   * 沒有這條，tenant_admin 可以建一個含 `tenants:onboard` 的角色再指派給自己。
   * **在 server 端比對，不是靠前端只送得出看得到的東西**（會改請求的人不受前端限制）。
   */
  async create(args: {
    tenantId: string;
    callerUserId: string;
    roleKey: string;
    roleName: string;
    baselineRole: string;
    permissionIds: string[];
  }): Promise<{ roleId: string }> {
    const { tenantId, callerUserId, roleKey, roleName, baselineRole, permissionIds } = args;

    if (!/^[a-z][a-z0-9_-]{1,50}$/.test(roleKey)) {
      throw new BadRequestException({
        status: "invalid_role_key",
        message: "角色代號需為小寫英文開頭，只能用英文、數字、- 或 _",
      });
    }
    if (!roleName.trim()) {
      throw new BadRequestException({ status: "invalid_role_name", message: "請填角色名稱" });
    }
    // ⚠️ assistant / consultant / aiproot_admin 不在清單裡 —— 它們是平台角色，
    //    在 app_is_platform_ops() 的白名單中而那個函式沒有租戶條件（V-2 · P0）。
    //    DB 的 CHECK 也擋一次，這裡是為了給看得懂的錯誤訊息。
    if (!BASELINE_ROLES.includes(baselineRole as BaselineRole)) {
      throw new BadRequestException({
        status: "invalid_baseline",
        message: "資料範圍只能選「只看自己」「只看自己部門」或「看全公司」",
      });
    }

    await this.assertWithinCallerPermissions(callerUserId, permissionIds);

    const tx = currentTx();

    // 名稱重複要回看得懂的話，不要把 pg 23505 丟到畫面上
    const dup = await tx.execute(sql`
      SELECT 1 FROM roles WHERE tenant_id = ${tenantId}::uuid AND role_key = ${roleKey} LIMIT 1
    `);
    if (dup.rows.length > 0) {
      throw new BadRequestException({
        status: "role_key_exists",
        message: `角色代號「${roleKey}」已經有人用了，換一個`,
      });
    }

    const created = await tx.execute<{ role_id: string }>(sql`
      INSERT INTO roles (role_key, role_name, tenant_id, is_system, baseline_role)
      VALUES (${roleKey}, ${roleName.trim()}, ${tenantId}::uuid, false, ${baselineRole})
      RETURNING role_id
    `);
    const roleId = created.rows[0].role_id;

    if (permissionIds.length > 0) {
      const values = permissionIds.map((pid) => sql`(${roleId}::uuid, ${pid})`);
      await tx.execute(sql`
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT DO NOTHING
      `);
    }

    this.perms.invalidateAll();
    this.logger.log(`建立自訂角色 · tenant=${tenantId} key=${roleKey} baseline=${baselineRole} perms=${permissionIds.length}`);
    return { roleId };
  }

  /**
   * 把自訂角色指派給人。
   *
   * ⚠️ `role` 與 `role_id` **必須同一句 UPDATE 一起寫**（V-4/V-5 · P0）：
   *    只寫 role_id → app.actor_role 還是舊值 → 資料範圍不對（可能過寬）
   *    只寫 role    → 權限退回基準角色 → 少權限、畫面全白
   */
  async assign(args: {
    tenantId: string;
    callerUserId: string;
    userId: string;
    roleId: string | null;
  }): Promise<{ role: string }> {
    const { tenantId, callerUserId, userId, roleId } = args;
    const tx = currentTx();

    // 取消自訂角色 → 退回基準對應的內建角色
    if (!roleId) {
      const cur = await tx.execute<{ role: string }>(sql`
        UPDATE users SET role_id = NULL
        WHERE user_id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid
        RETURNING role
      `);
      if (cur.rows.length === 0) throw new BadRequestException({ status: "user_not_found", message: "找不到這位成員" });
      this.perms.invalidateAll();
      return { role: cur.rows[0].role };
    }

    const role = await tx.execute<{ role_key: string; role_name: string; baseline_role: string }>(sql`
      SELECT role_key, role_name, COALESCE(baseline_role, role_key) AS baseline_role
      FROM roles
      WHERE role_id = ${roleId}::uuid AND tenant_id = ${tenantId}::uuid AND is_system = false
      LIMIT 1
    `);
    if (role.rows.length === 0) {
      // 別家租戶的角色 / 不存在 / 內建角色 —— 都回同一句，不洩漏哪一種
      throw new BadRequestException({ status: "role_not_found", message: "找不到這個角色" });
    }
    const baseline = role.rows[0].baseline_role;
    if (!BASELINE_ROLES.includes(baseline as BaselineRole)) {
      throw new BadRequestException({ status: "invalid_baseline", message: "這個角色的資料範圍設定有問題，請聯繫 AIPROOT" });
    }

    // 防提權第二道（K8s 的 `bind` verb）：指派出去的權限也不能超過呼叫者自己的
    const rolePerms = await tx.execute<{ permission_id: string }>(sql`
      SELECT permission_id FROM role_permissions WHERE role_id = ${roleId}::uuid
    `);
    await this.assertWithinCallerPermissions(callerUserId, rolePerms.rows.map((r) => r.permission_id));

    // ⚠️ V-7（P0 · happy path 測不出來）：基準是「只看自己部門」但那個人沒有部門
    //    → RLS 的 current_department 會是 null → **看得到全租戶**。
    //    症狀是「看太多」而不是「壞掉」，所以這裡要主動擋，不能預設放行。
    const target = await tx.execute<{ department_id: string | null; display_name: string | null }>(sql`
      SELECT department_id::text, display_name FROM users
      WHERE user_id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
    `);
    if (target.rows.length === 0) {
      throw new BadRequestException({ status: "user_not_found", message: "找不到這位成員" });
    }
    if (baseline === "group_owner" && !target.rows[0].department_id) {
      throw new BadRequestException({
        status: "department_required",
        message: "這個角色的範圍是「只看自己部門」，請先幫這位成員指定所屬部門",
      });
    }

    await tx.execute(sql`
      UPDATE users SET role = ${baseline}, role_id = ${roleId}::uuid
      WHERE user_id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid
    `);

    this.perms.invalidateAll();
    this.logger.log(`指派自訂角色 · tenant=${tenantId} user=${userId} role=${role.rows[0].role_key} baseline=${baseline}`);
    return { role: baseline };
  }

  /** 刪除自訂角色 · 還有人在用就擋（V-8）—— 直接刪會讓那些人默默退回基準角色 */
  async remove(args: { tenantId: string; roleId: string }): Promise<void> {
    const tx = currentTx();
    const inUse = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM users u
      JOIN roles r ON r.role_id = u.role_id
      WHERE r.role_id = ${args.roleId}::uuid AND r.tenant_id = ${args.tenantId}::uuid
    `);
    if ((inUse.rows[0]?.n ?? 0) > 0) {
      throw new BadRequestException({
        status: "role_in_use",
        message: `還有 ${inUse.rows[0].n} 位成員在用這個角色，請先幫他們改成別的角色`,
      });
    }
    const res = await tx.execute(sql`
      DELETE FROM roles
      WHERE role_id = ${args.roleId}::uuid AND tenant_id = ${args.tenantId}::uuid
        AND is_system = false AND baseline_role IS NOT NULL
    `);
    if ((res.rowCount ?? 0) === 0) {
      throw new BadRequestException({ status: "role_not_found", message: "找不到這個角色" });
    }
    this.perms.invalidateAll();
  }

  /**
   * 防提權的共用檢查：`permissionIds` 必須是呼叫者有效權限的子集，
   * 而且一律限縮在租戶看得到的 scope 內（platform 那 33 項連送都不該送得進來）。
   */
  private async assertWithinCallerPermissions(callerUserId: string, permissionIds: string[]): Promise<void> {
    if (permissionIds.length === 0) return;

    const visible = await currentTx().execute<{ permission_id: string }>(sql`
      SELECT permission_id FROM permissions
      WHERE scope IN (${sql.join(TENANT_VISIBLE_SCOPES.map((v) => sql`${v}`), sql`, `)})
    `);
    const visibleSet = new Set(visible.rows.map((r) => r.permission_id));
    const outOfScope = permissionIds.filter((p) => !visibleSet.has(p));
    if (outOfScope.length > 0) {
      throw new BadRequestException({
        status: "permission_out_of_scope",
        message: `有 ${outOfScope.length} 項權限不開放調整`,
      });
    }

    const mine = await this.perms.getUserPermissions(callerUserId);
    const escalating = permissionIds.filter((p) => !mine.has(p));
    if (escalating.length > 0) {
      throw new ForbiddenException({
        status: "privilege_escalation",
        message: `你自己沒有其中 ${escalating.length} 項權限，不能把它們給別人`,
      });
    }
  }
}
