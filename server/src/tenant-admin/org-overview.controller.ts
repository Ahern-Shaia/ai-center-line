import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { resolveTenantId } from "../auth/resolve-tenant-id.js";
import { OrgOverviewService } from "./org-overview.service.js";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 組織關係圖（org-overview M1）· 讀專用。aiproot 可帶 tenantId 看任一家；tenant_admin 鎖自租戶（防 IDOR）。
@Controller("tenant-admin/org-overview")
export class OrgOverviewController {
  constructor(private readonly svc: OrgOverviewService) {}

  @Get()
  @RequirePermission("users:view")
  async get(@CurrentUser() user: JwtUser, @Query("tenantId") tenantId?: string) {
    const t = resolveTenantId(user, tenantId);
    if (!uuidRegex.test(t)) throw new BadRequestException({ status: "tenant_id_required", message: "需傳 tenantId" });
    return this.svc.get(t);
  }
}
