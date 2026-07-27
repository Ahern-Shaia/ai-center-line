import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { AuditService, type AuditScope } from "./audit.service.js";

const SCOPES = new Set(["all", "write", "login"]);

@Controller("audit")
export class AuditController {
  constructor(private readonly svc: AuditService) {}

  // RLS 已把範圍切到本租戶（aiproot_admin 例外，可跨租戶）
  @Get()
  @Roles("aiproot_admin", "consultant", "tenant_admin")
  @RequirePermission("audit:view")
  async list(@Query("scope") scope?: string, @Query("page") page?: string) {
    if (scope && !SCOPES.has(scope)) throw new BadRequestException("scope 不正確");
    const p = page ? Number(page) : 1;
    if (!Number.isFinite(p) || p < 1) throw new BadRequestException("page 格式不正確");
    return this.svc.list({ scope: scope as AuditScope | undefined, page: p });
  }
}
