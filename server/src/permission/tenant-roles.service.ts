import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";
import { PermissionService } from "./permission.service.js";

// 租戶自管角色權限 · docs/modules/tenant-role-permissions.md v0.2
//
// 為什麼是獨立一支 service 而不是塞進 permission.service：
// 那支是「解析某個人有哪些權限」（讀路徑、有快取、被 guard 每個請求呼叫），
// 這支是「租戶改角色」（寫路徑、一天用不到幾次）。混在一起會讓熱路徑跟著變胖。

/**
 * 租戶可以編輯的角色 —— **白名單寫在後端**，前端只是呈現。
 *
 * ⚠️ `tenant_admin` 刻意不在裡面（P0-C）：讓總經理編輯自己的角色，
 *    他可以把 users:manage / tenants:onboard 勾給自己或勾給全體員工，
 *    那是平台級操作。要改仍然找我們。
 */
/**
 * ⚠️ `assistant` 也**刻意不在裡面**（2026-08-21 移除 · 原本錯放）。
 *
 * 「助理」是 **AIPROOT 內部角色**，不是租戶角色。它的兩項權限
 * `notify-config:view` / `notify-config:manage` 都是 `scope=platform`，
 * 而那三張表（notification_rule / notify_config / ragic_account）的 policy 是：
 *
 *     app_is_platform_ops() = actor_role IN (aiproot_admin, consultant, assistant, system)
 *
 * **純角色白名單、沒有任何租戶條件** —— 表上雖然有 tenant_id 也有 FORCE RLS，
 * 但這條 policy 直接放行全部列。租戶只要生得出一個 assistant，
 * 那個人就讀得到**所有租戶**的通知規則與 **Ragic API 金鑰**。
 *
 * 放進這個清單造成的實際症狀（客戶回報「權限管理不同步」的一半原因）：
 *   · 權限管理列出「助理 · 2 項權限」，但那 2 項是 platform scope、畫面上根本沒有
 *     → 顯示「已勾 2 / 32」而使用者一個勾都找不到
 *   · 租戶又永遠指派不了這個角色（0049 擋在 assignableRolesFor）
 *   → 一個看得到、改不動、也用不了的角色。拿掉才是對的。
 */
export const TENANT_EDITABLE_ROLE_KEYS = ["employee", "group_owner"] as const;

/**
 * 租戶看得到的權限範圍。
 *
 * ⚠️ platform 那 34 項**不是灰掉，是不回傳**（P0-B）。
 *    裡面有 binding:aiproot-view（跨租戶檢視別家客戶的綁定稽核）這種東西，
 *    靠前端隱藏擋不住會改請求的人。看不到就勾不了。
 */
const TENANT_VISIBLE_SCOPES = ["tenant", "department"] as const;

export interface TenantPermissionItem {
  permissionId: string;
  description: string;
  scope: string;
}

export interface TenantRoleItem {
  roleKey: string;
  roleName: string;
  permissions: string[];
  /** 已分岔＝這個租戶自己改過，不再跟隨系統預設 */
  isCustomized: boolean;
  /** 使用這個角色的人數 · 用來算「移除權限會影響幾個人」 */
  memberCount: number;
}

@Injectable()
export class TenantRolesService {
  private readonly logger = new Logger(TenantRolesService.name);

  constructor(private readonly perms: PermissionService) {}

  /** 租戶視角的權限清單 · 只有 tenant / department 級 */
  async listPermissions(): Promise<TenantPermissionItem[]> {
    const res = await currentTx().execute<{
      permission_id: string; description: string; scope: string;
    }>(sql`
      SELECT permission_id, description, scope FROM permissions
      WHERE scope IN (${sql.join(TENANT_VISIBLE_SCOPES.map((v) => sql`${v}`), sql`, `)})
      ORDER BY resource, action
    `);
    return res.rows.map((r) => ({
      permissionId: r.permission_id, description: r.description, scope: r.scope,
    }));
  }

  /**
   * 租戶視角的角色清單 · 只有白名單那三個。
   *
   * 有分岔過就回租戶版的權限，沒有就回內建版 —— 呼叫端不必知道有沒有分岔過，
   * 只看 `isCustomized`。
   */
  async listRoles(tenantId: string): Promise<TenantRoleItem[]> {
    const res = await currentTx().execute<{
      role_key: string; role_name: string;
      permission_ids: string[]; is_customized: boolean; member_count: number;
    }>(sql`
      WITH wanted(role_key) AS (
        VALUES ${sql.join(TENANT_EDITABLE_ROLE_KEYS.map((v) => sql`(${v}::text)`), sql`, `)}
      ),
      -- 同一個 role_key 可能有兩列（內建 + 該租戶的副本）· 有副本就用副本
      picked AS (
        SELECT w.role_key,
               COALESCE(t.role_id, s.role_id)     AS role_id,
               COALESCE(t.role_name, s.role_name) AS role_name,
               (t.role_id IS NOT NULL)            AS is_customized
        FROM wanted w
        LEFT JOIN roles s ON s.role_key = w.role_key AND s.is_system = true
        LEFT JOIN roles t ON t.role_key = w.role_key AND t.tenant_id = ${tenantId}::uuid
      )
      SELECT p.role_key, p.role_name, p.is_customized,
             -- ⚠️ 只算**租戶看得見**的那些 —— 這裡若不過濾，畫面會顯示
             --    「已勾 N / 32」而使用者在 32 項裡一個勾都找不到（那 N 項是 platform scope，
             --    根本沒被列出來）。數字要對得上眼睛看到的東西。
             COALESCE(ARRAY_AGG(rp.permission_id) FILTER (
               WHERE rp.permission_id IS NOT NULL
                 AND perm.scope IN (${sql.join(TENANT_VISIBLE_SCOPES.map((v) => sql`${v}`), sql`, `)})
             ), '{}') AS permission_ids,
             (SELECT count(*)::int FROM users u
               WHERE u.tenant_id = ${tenantId}::uuid
                 AND COALESCE((SELECT r2.role_key FROM roles r2 WHERE r2.role_id = u.role_id), u.role) = p.role_key
             ) AS member_count
      FROM picked p
      LEFT JOIN role_permissions rp ON rp.role_id = p.role_id
      LEFT JOIN permissions perm ON perm.permission_id = rp.permission_id
      GROUP BY p.role_key, p.role_name, p.is_customized, p.role_id
      ORDER BY p.role_key
    `);
    return res.rows.map((r) => ({
      roleKey: r.role_key, roleName: r.role_name,
      permissions: r.permission_ids,
      isCustomized: r.is_customized,
      memberCount: r.member_count,
    }));
  }

  /**
   * 改某個角色的權限 · **第一次改就分岔**（fork on edit）。
   *
   * ⚠️⚠️ 分岔與 `users.role_id` 的更新**必須在同一交易** —— 這是本模組唯一
   *      沒有結構解的 P0：漏改的人會靜默沿用內建角色，而畫面看起來一切正常。
   *      這裡走 `currentTx()`（TenantTxInterceptor 已經開好的請求交易），
   *      所以「同一交易」是天然成立的，不必自己開 tx 也不會忘記。
   *
   * 順帶：`users` 有 RLS 且 `current_tenant` 已由 interceptor 設好，
   * 即使 tenantId 參數被傳錯，那句 UPDATE 也跨不出這個租戶（縱深防禦）。
   */
  async updatePermissions(args: {
    tenantId: string;
    roleKey: string;
    permissionIds: string[];
  }): Promise<{ forked: boolean; count: number }> {
    const { tenantId, roleKey } = args;
    if (!TENANT_EDITABLE_ROLE_KEYS.includes(roleKey as typeof TENANT_EDITABLE_ROLE_KEYS[number])) {
      throw new ForbiddenException(`「${roleKey}」這個角色不開放自行調整，請聯繫 AIPROOT`);
    }

    // 不信前端傳來的清單 —— 逐項驗證都在允許範圍內
    const allowed = new Set((await this.listPermissions()).map((p) => p.permissionId));
    const bad = args.permissionIds.filter((p) => !allowed.has(p));
    if (bad.length > 0) {
      throw new BadRequestException(`有 ${bad.length} 項權限不開放調整`);
    }

    const tx = currentTx();

    // ① 找租戶版；沒有就分岔
    const existing = await tx.execute<{ role_id: string }>(sql`
      SELECT role_id FROM roles WHERE role_key = ${roleKey} AND tenant_id = ${tenantId}::uuid LIMIT 1
    `);
    let roleId = existing.rows[0]?.role_id;
    let forked = false;

    if (!roleId) {
      const sys = await tx.execute<{ role_name: string }>(sql`
        SELECT role_name FROM roles WHERE role_key = ${roleKey} AND is_system = true LIMIT 1
      `);
      if (!sys.rows[0]) throw new BadRequestException(`找不到角色「${roleKey}」`);

      const created = await tx.execute<{ role_id: string }>(sql`
        INSERT INTO roles (role_key, role_name, tenant_id, is_system)
        VALUES (${roleKey}, ${sys.rows[0].role_name}, ${tenantId}::uuid, false)
        RETURNING role_id
      `);
      roleId = created.rows[0].role_id;
      forked = true;

      // ⚠️ 這一句漏掉 = P0。用「有效角色」比對（role_id 指到的 role_key，
      //    沒有 role_id 才看 role 字串），才不會漏掉已經有 role_id 的人。
      const moved = await tx.execute(sql`
        UPDATE users u SET role_id = ${roleId}::uuid
        WHERE u.tenant_id = ${tenantId}::uuid
          AND COALESCE((SELECT r.role_key FROM roles r WHERE r.role_id = u.role_id), u.role) = ${roleKey}
      `);
      this.logger.log(`角色分岔 · tenant=${tenantId} role=${roleKey} · 已改指 ${moved.rowCount ?? 0} 位成員`);
    }

    // ② 換掉權限 —— 但**只換租戶看得見的那些**。
    //
    // ⚠️ 原本是無條件 DELETE 全部再 INSERT 送進來的，那會**靜默砍掉租戶看不見的權限**：
    //    前端只送得出 tenant/department 級的（platform 級根本沒被列出來給他勾），
    //    所以一次存檔就會把該角色的 platform 權限清空，而畫面上完全看不出發生過什麼。
    //    分岔的當下更嚴重 —— 新角色是空的，舊的 platform 權限一開始就沒被複製過來。
    //
    // 目前 employee/group_owner 都沒有 platform 權限，所以這條現在不會觸發；
    // 但「使用者改不到的東西，不該被使用者的存檔動到」是結構要求，不是個案修補。
    const keepScopes = sql.join(TENANT_VISIBLE_SCOPES.map((v) => sql`${v}`), sql`, `);

    if (forked) {
      // 分岔：把系統角色裡**租戶看不見**的權限原樣複製過來（看得見的由下面的 INSERT 決定）
      await tx.execute(sql`
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT ${roleId}::uuid, rp.permission_id
        FROM roles s
        JOIN role_permissions rp ON rp.role_id = s.role_id
        JOIN permissions p ON p.permission_id = rp.permission_id
        WHERE s.role_key = ${roleKey} AND s.is_system = true
          AND p.scope NOT IN (${keepScopes})
        ON CONFLICT DO NOTHING
      `);
    }

    await tx.execute(sql`
      DELETE FROM role_permissions rp
      USING permissions p
      WHERE rp.role_id = ${roleId}::uuid
        AND p.permission_id = rp.permission_id
        AND p.scope IN (${keepScopes})
    `);
    if (args.permissionIds.length > 0) {
      const values = args.permissionIds.map((pid) => sql`(${roleId}::uuid, ${pid})`);
      await tx.execute(sql`
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT DO NOTHING
      `);
    }

    this.perms.invalidateAll();
    return { forked, count: args.permissionIds.length };
  }

  /**
   * 還原成系統預設 · 刪掉租戶版、把人指回內建角色。
   *
   * 這不是加分功能 —— 租戶可能把 warroom:view 從所有角色拿光，
   * 那時整家公司看不到任何東西，而他自己救不回來。
   */
  async resetToDefault(args: { tenantId: string; roleKey: string }): Promise<{ restored: boolean }> {
    const { tenantId, roleKey } = args;
    if (!TENANT_EDITABLE_ROLE_KEYS.includes(roleKey as typeof TENANT_EDITABLE_ROLE_KEYS[number])) {
      throw new ForbiddenException(`「${roleKey}」這個角色不開放自行調整，請聯繫 AIPROOT`);
    }
    const tx = currentTx();

    const own = await tx.execute<{ role_id: string }>(sql`
      SELECT role_id FROM roles WHERE role_key = ${roleKey} AND tenant_id = ${tenantId}::uuid LIMIT 1
    `);
    if (!own.rows[0]) return { restored: false };   // 本來就沒改過

    const sys = await tx.execute<{ role_id: string }>(sql`
      SELECT role_id FROM roles WHERE role_key = ${roleKey} AND is_system = true LIMIT 1
    `);
    if (!sys.rows[0]) throw new BadRequestException(`找不到「${roleKey}」的系統預設`);

    // ⚠️ 先把人指回內建角色，再刪租戶版。
    //    順序反了的話 role_permissions 會被 CASCADE 掉、而 users.role_id 還指著
    //    已刪除的 role（FK 是 SET NULL 還是 RESTRICT 取決於定義，不要賭）。
    //    指回「內建的 role_id」而不是 NULL —— 不依賴 users.role 這個過渡欄位有沒有填對。
    await tx.execute(sql`
      UPDATE users SET role_id = ${sys.rows[0].role_id}::uuid
      WHERE tenant_id = ${tenantId}::uuid AND role_id = ${own.rows[0].role_id}::uuid
    `);
    await tx.execute(sql`DELETE FROM roles WHERE role_id = ${own.rows[0].role_id}::uuid`);

    this.perms.invalidateAll();
    this.logger.log(`角色還原 · tenant=${tenantId} role=${roleKey}`);
    return { restored: true };
  }
}
