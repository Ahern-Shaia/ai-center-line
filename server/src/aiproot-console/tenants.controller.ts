import { BadRequestException, Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";
import { EXTRACTION_TEMPLATES, TEMPLATE_REGISTRY, type ExtractionTemplate } from "../conversation-analysis/pipeline/templates.js";

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
  @RequirePermission("tenants:view")
  async list() {
    const tx = currentTx();
    const res = await tx.execute<{
      tenant_id: string; tenant_name: string; batch_enabled: boolean; extraction_template: string | null;
    }>(sql`
      SELECT tenant_id::text AS tenant_id, tenant_name, batch_enabled, extraction_template
      FROM tenants
      ORDER BY tenant_name ASC
    `);
    return {
      tenants: res.rows.map((r) => ({
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        batchEnabled: r.batch_enabled,
        extractionTemplate: r.extraction_template ?? "factory_report",
      })),
    };
  }

  /**
   * 某租戶的登入帳號一覽（aiproot 救援用）。
   * 開通租戶時的一次性密碼只顯示一次，之後忘記帳號或密碼就完全無從查起——
   * 這裡只回「是誰、狀態如何」，密碼一律不回（雜湊也不回），要救就走 reset-password 產新的。
   */
  @Get(":tenantId/users")
  @RequirePermission("tenants:manage")
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

  /**
   * 可選的 L2 業種模板。
   * ⚠️ `selectable: false` 的模板不會出現在下拉裡，而畫面上看不出「有一個被藏起來」——
   *    2026-07-30 就因此把台灣福祉切成了 `factory_report`（以為那是唯一的 L2 選項）。
   *    要藏模板時記得：它就只剩手動下 prod SQL 一條路，而那條路有 RLS 靜默失敗。
   */
  @Get("extraction-templates")
  @RequirePermission("tenants:view")
  templates() {
    return {
      templates: EXTRACTION_TEMPLATES
        .filter((t) => TEMPLATE_REGISTRY[t].selectable)
        .map((t) => ({ key: t, label: TEMPLATE_REGISTRY[t].label, description: TEMPLATE_REGISTRY[t].description })),
    };
  }

  /**
   * 換該租戶的 L2 業種模板。
   * ⚠️ 只影響**之後**的分析 —— 已抽的結果不回溯重跑（R11 原始不可變），
   *    analysis_result.extraction_template 記著當時用的是哪個，歷史仍可正確解讀。
   */
  @Patch(":tenantId/extraction-template")
  @RequirePermission("tenants:manage")
  async setExtractionTemplate(
    @Param("tenantId") tenantId: string,
    @Body() body: { template?: string },
  ) {
    if (!UUID_RE.test(tenantId)) throw new BadRequestException("tenantId 格式不正確");
    const t = body?.template as ExtractionTemplate | undefined;
    if (!t || !TEMPLATE_REGISTRY[t]?.selectable) {
      throw new BadRequestException("模板不存在或尚未開放選用");
    }
    const res = await currentTx().execute<{ tenant_id: string }>(sql`
      UPDATE tenants SET extraction_template = ${t}
       WHERE tenant_id = ${tenantId}::uuid
      RETURNING tenant_id::text
    `);
    if (res.rows.length === 0) throw new BadRequestException("tenant 不存在");
    return { tenantId, template: t, label: TEMPLATE_REGISTRY[t].label };
  }

  // 切 batch_enabled · convo-analysis-realtime cron 是否掃該 tenant
  @Patch(":tenantId/batch-enabled")
  @RequirePermission("tenants:manage")
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
