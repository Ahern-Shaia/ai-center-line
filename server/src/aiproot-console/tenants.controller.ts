import { BadRequestException, Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { Roles } from "../auth/roles.decorator.js";
import { currentTx } from "../db/client.js";

/**
 * aiproot 通用：列 / 設定所有租戶
 * · 用 currentTx() 繼承 aiproot_admin actor_role (tenants RLS bypass)
 */
@Controller("aiproot-console/tenants")
export class AiprootTenantsController {
  @Get()
  @Roles("aiproot_admin", "consultant")
  async list() {
    const tx = currentTx();
    const res = await tx.execute<{
      tenant_id: string; tenant_name: string; batch_enabled: boolean;
    }>(sql`
      SELECT tenant_id::text AS tenant_id, tenant_name, batch_enabled
      FROM tenants
      ORDER BY tenant_name ASC
    `);
    return {
      tenants: res.rows.map((r) => ({
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        batchEnabled: r.batch_enabled,
      })),
    };
  }

  // 切 batch_enabled · convo-analysis-realtime cron 是否掃該 tenant
  @Patch(":tenantId/batch-enabled")
  @Roles("aiproot_admin")
  async setBatchEnabled(
    @Param("tenantId") tenantId: string,
    @Body() body: { enabled: boolean },
  ) {
    if (typeof body?.enabled !== "boolean") {
      throw new BadRequestException("body.enabled 需為 boolean");
    }
    const tx = currentTx();
    const res = await tx.execute<{ tenant_id: string; batch_enabled: boolean }>(sql`
      UPDATE tenants
      SET batch_enabled = ${body.enabled}
      WHERE tenant_id = ${tenantId}::uuid
      RETURNING tenant_id::text, batch_enabled
    `);
    if (res.rows.length === 0) throw new BadRequestException("tenant 不存在");
    return { tenantId: res.rows[0].tenant_id, batchEnabled: res.rows[0].batch_enabled };
  }
}
