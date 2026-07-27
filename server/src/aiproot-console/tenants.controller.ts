import { BadRequestException, Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { Roles } from "../auth/roles.decorator.js";
import { currentTx } from "../db/client.js";

/**
 * aiproot 通用：列 / 設定所有租戶
 * · 用 currentTx() 繼承 aiproot_admin actor_role (tenants RLS bypass)
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// drizzle execute<T> 需要 type alias（interface 沒有隱含 index signature）
type RawUserRow = {
  user_id: string; email: string | null; display_name: string | null; role: string;
  must_change_password: boolean; locked_until: string | null; last_login_at: string | null;
  failed_login_count: number; password_updated_at: string | null; department_name: string | null;
};

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

  /**
   * 某租戶的登入帳號一覽（aiproot 救援用）。
   * 開通租戶時的一次性密碼只顯示一次，之後忘記帳號或密碼就完全無從查起——
   * 這裡只回「是誰、狀態如何」，密碼一律不回（雜湊也不回），要救就走 reset-password 產新的。
   */
  @Get(":tenantId/users")
  @Roles("aiproot_admin")
  async users(@Param("tenantId") tenantId: string) {
    if (!UUID_RE.test(tenantId)) throw new BadRequestException("tenantId 格式不正確");
    const res = await currentTx().execute<RawUserRow>(sql`
      SELECT u.user_id::text, u.email, u.display_name, u.role, u.must_change_password,
             u.locked_until, u.last_login_at, u.failed_login_count, u.password_updated_at,
             COALESCE(d.display_name, d.department_name) AS department_name
        FROM users u
        LEFT JOIN departments d ON d.department_id = u.department_id
       WHERE u.tenant_id = ${tenantId}::uuid
       ORDER BY CASE u.role WHEN 'tenant_admin' THEN 0 WHEN 'group_owner' THEN 1 ELSE 2 END,
                u.display_name NULLS LAST
    `);
    return {
      users: res.rows.map((r) => ({
        userId: r.user_id,
        email: r.email,
        displayName: r.display_name,
        role: r.role,
        departmentName: r.department_name,
        mustChangePassword: r.must_change_password,
        locked: r.locked_until != null && new Date(r.locked_until).getTime() > Date.now(),
        lockedUntil: r.locked_until,
        lastLoginAt: r.last_login_at,
        failedLoginCount: r.failed_login_count,
        passwordUpdatedAt: r.password_updated_at,
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
