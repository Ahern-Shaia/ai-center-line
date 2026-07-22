import { Controller, Get } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { Roles } from "../auth/roles.decorator.js";
import { withSystemTx } from "../db/client.js";

/**
 * aiproot 通用：列所有租戶 · 給下拉選單用（batch filter / cost filter / 未來 aiproot 各 dashboard）
 * · 走 withSystemTx bypass RLS · role guard 限 aiproot_admin/consultant
 * · 不含敏感欄位（address / phone / ...）· 只回顯示需要的
 */
@Controller("aiproot-console/tenants")
export class AiprootTenantsController {
  @Get()
  @Roles("aiproot_admin", "consultant")
  async list() {
    const res = await withSystemTx((tx) => tx.execute<{
      tenant_id: string; tenant_name: string;
    }>(sql`
      SELECT tenant_id::text AS tenant_id, tenant_name
      FROM tenants
      ORDER BY tenant_name ASC
    `));
    return { tenants: res.rows.map((r) => ({ tenantId: r.tenant_id, tenantName: r.tenant_name })) };
  }
}
