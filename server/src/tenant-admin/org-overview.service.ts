import { Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { withTenant } from "../db/client.js";
import { msg } from "../i18n/index.js";

// 組織關係圖資料（org-overview M1）· 彙整 departments / users / line_group，無新表。
// 走 withSystemTx + 明確 tenant filter（不靠 RLS 靜默）· caller 已 resolveTenantId → 不可跨租戶。

export interface OrgMember {
  name: string;
  role: string;                        // group_owner=部門主管 / employee=員工
  hasLineBinding: boolean;
  departmentSource: "auto" | "manual";
}
export interface OrgCrossGroup {
  name: string;
  /** 'process' 跨部門作業群 · 'announcement' 全員／公告群 */
  groupType: string;
  memberCount: number;
}
export interface OrgOverview {
  company: string;
  gm: string[];                        // 總經理室成員顯示名
  departments: Array<{ name: string; groups: string[]; members: OrgMember[] }>;
  /** 不定義組織的群（0068 · group-type-classification.md §4.2）· 不畫進部門樹、不進健康度分母 */
  crossGroups: OrgCrossGroup[];
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
      if (!t.rows[0]) throw new NotFoundException(msg("srv.user.tenantNotFound"));

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

      const groups = await tx.execute<{
        dept: string | null; display_name: string | null; group_id: string;
        group_type: string; member_count: number;
      }>(sql`
        SELECT lg.department_id::text AS dept, lg.display_name, lg.group_id, lg.group_type,
               (SELECT count(*)::int FROM line_member m
                 WHERE m.bot_id = lg.bot_id AND m.group_id = lg.group_id AND m.fetch_error IS NULL
               ) AS member_count
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

      // ⭐ 判準：一個「部門」只有在**它不是純粹為了裝非部門群而存在**時，才算組織單位。
      //
      //   有你真好   → 唯一的群是 announcement 型  → 不是組織單位（它是全公司社交群）
      //   報工及車輛調度 → 唯一的群是 process 型      → 不是組織單位（跨部門作業）
      //   售後服務   → **一個群都沒有**              → 仍是組織單位（只是還沒接群）
      //
      // 「沒有群」與「只有非部門群」是兩件事：前者是導入還沒做完，後者是分類錯。
      // 把兩者混為一談會讓剛建好還沒接群的部門憑空消失。
      const isOrgUnit = (deptId: string) => {
        const own = groups.rows.filter((g) => g.dept === deptId);
        if (own.length === 0) return true;
        return own.some((g) => g.group_type === "department");
      };

      const departments = depts.rows.filter((d) => isOrgUnit(d.id)).map((d) => ({
        name: d.name,
        // 只列部門群 —— 非部門群移到 crossGroups，不在部門卡上出現
        groups: groups.rows.filter((g) => g.dept === d.id && g.group_type === "department").map(groupName),
        members: users.rows.filter((u) => u.dept === d.id && DEPT_MEMBER_ROLES.has(u.role)).map(toMember),
      }));

      // 跨部門群組 · 仍然分析、仍然出任務（任務照樣掛在它的 department_id 下），
      // 只是不再宣稱「這些人屬於那個部門」
      const crossGroups: OrgCrossGroup[] = groups.rows
        .filter((g) => g.group_type === "process" || g.group_type === "announcement")
        .map((g) => ({ name: groupName(g), groupType: g.group_type, memberCount: g.member_count }))
        .sort((a, b) => b.memberCount - a.memberCount);

      const unassigned = {
        // test 型不列進「未分派」—— 那是待補的意思，測試群不需要補
        groups: groups.rows.filter((g) => g.dept === null && g.group_type !== "test").map(groupName),
        members: users.rows.filter((u) => u.dept === null && DEPT_MEMBER_ROLES.has(u.role)).map(toMember),
      };

      return { company: t.rows[0].tenant_name, gm, departments, crossGroups, unassigned };
    });
  }
}
