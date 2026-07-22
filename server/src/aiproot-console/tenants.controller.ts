import { Controller, Get } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { Roles } from "../auth/roles.decorator.js";
import { currentTx } from "../db/client.js";

/**
 * aiproot 通用：列所有租戶 · 給下拉選單用（batch filter / cost filter / 未來 aiproot 各 dashboard）
 * · 用 currentTx() 繼承 TenantTxInterceptor set 的 actor_role='aiproot_admin'
 *   (tenants RLS 只放行 aiproot_admin bypass · 不含 system · 走 withSystemTx 會空)
 * · role guard 限 aiproot_admin/consultant · 不含敏感欄位
 */
@Controller("aiproot-console/tenants")
export class AiprootTenantsController {
  @Get()
  @Roles("aiproot_admin", "consultant")
  async list() {
    const tx = currentTx();
    const res = await tx.execute<{
      tenant_id: string; tenant_name: string;
    }>(sql`
      SELECT tenant_id::text AS tenant_id, tenant_name
      FROM tenants
      ORDER BY tenant_name ASC
    `);
    return { tenants: res.rows.map((r) => ({ tenantId: r.tenant_id, tenantName: r.tenant_name })) };
  }
}
