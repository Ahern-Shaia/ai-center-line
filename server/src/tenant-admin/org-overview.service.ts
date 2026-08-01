import { Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { withTenant } from "../db/client.js";

// 組織關係圖資料（org-overview M1）· 彙整 departments / users / line_group，無新表。
// 走 withSystemTx + 明確 tenant filter（不靠 RLS 靜默）· caller 已 resolveTenantId → 不可跨租戶。

export interface OrgMember {
  name: string;
  role: string;                        // group_owner=部門主管 / employee=員工
  hasLineBinding: boolean;
  departmentSource: "auto" | "manual";
}
export interface OrgOverview {
  company: string;
  gm: string[];                        // 總經理室成員顯示名
  departments: Array<{ name: string; groups: string[]; members: OrgMember[] }>;
  unassigned: { groups: string[]; members: OrgMember[] };
}

const DEPT_MEMBER_ROLES = new Set(["employee", "group_owner"]);

@Injectable()
export class OrgOverviewService {
  async get(tenantId: string): Promise<OrgOverview> {
    // ⚠️ 不用 withSystemTx：tenants/departments/users 的 RLS 沒有 system escape，system 會靜默回 0 列。
    // 設 current_tenant=tenantId（departments/users 靠它）+ aiproot role（tenants 靠它）。
    // 每條 query 仍明確 WHERE tenant_id = tenantId → 即使 aiproot 能看全，也只回這一家（P0 隔離）。
    return withTenant({ tenantId, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
      const t = await tx.execute<{ tenant_name: string }>(sql`
        SELECT tenant_name FROM tenants WHERE tenant_id = ${tenantId}::uuid`);
      if (!t.rows[0]) throw new NotFoundException("找不到公司");

      const depts = await tx.execute<{ id: string; name: string }>(sql`
        SELECT department_id::text AS id, department_name AS name
        FROM departments WHERE tenant_id = ${tenantId}::uuid ORDER BY department_name`);

      const users = await tx.execute<{
        display_name: string | null; role: string; dept: string | null;
        department_source: "auto" | "manual"; bound: boolean;
      }>(sql`
        SELECT u.display_name, u.role, u.department_id::text AS dept, u.department_source,
               EXISTS(SELECT 1 FROM user_line_binding b WHERE b.user_id = u.user_id AND b.status = 'active') AS bound
        FROM users u WHERE u.tenant_id = ${tenantId}::uuid`);

      const groups = await tx.execute<{ dept: string | null; display_name: string | null; group_id: string }>(sql`
        SELECT lg.department_id::text AS dept, lg.display_name, lg.group_id
        FROM line_group lg JOIN line_bot bt ON bt.bot_id = lg.bot_id
        WHERE bt.tenant_id = ${tenantId}::uuid AND lg.status = 'active'`);

      const toMember = (u: (typeof users.rows)[number]): OrgMember => ({
        name: u.display_name ?? "（未命名）",
        role: u.role,
        hasLineBinding: u.bound,
        departmentSource: u.department_source,
      });
      const groupName = (g: (typeof groups.rows)[number]) =>
        g.display_name ?? `未命名群組 · ${g.group_id.slice(-6)}`;

      const gm = users.rows.filter((u) => u.role === "tenant_admin").map((u) => u.display_name ?? "（未命名）");

      const departments = depts.rows.map((d) => ({
        name: d.name,
        groups: groups.rows.filter((g) => g.dept === d.id).map(groupName),
        members: users.rows.filter((u) => u.dept === d.id && DEPT_MEMBER_ROLES.has(u.role)).map(toMember),
      }));

      const unassigned = {
        groups: groups.rows.filter((g) => g.dept === null).map(groupName),
        members: users.rows.filter((u) => u.dept === null && DEPT_MEMBER_ROLES.has(u.role)).map(toMember),
      };

      return { company: t.rows[0].tenant_name, gm, departments, unassigned };
    });
  }
}
