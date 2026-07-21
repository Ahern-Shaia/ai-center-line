import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { PermissionService } from "./permission.service.js";

@Controller()
export class PermissionController {
  constructor(private readonly svc: PermissionService) {}

  // GET /me/permissions · 目前登入使用者的 permission set
  @Get("me/permissions")
  async myPermissions(@CurrentUser() user: JwtUser) {
    const perms = await this.svc.getUserPermissions(user.user_id);
    return { permissions: Array.from(perms) };
  }

  // GET /permissions · 全部 · 給建 role 用
  @Get("permissions")
  @Roles("aiproot_admin", "consultant", "tenant_admin")
  async listAll() {
    return { permissions: await this.svc.listAllPermissions() };
  }

  // GET /roles · aiproot 看全 · tenant_admin 看 own tenant + 內建
  @Get("roles")
  @Roles("aiproot_admin", "consultant", "tenant_admin")
  async listRoles(@CurrentUser() user: JwtUser) {
    return { roles: await this.svc.listRoles(user.tenant_id) };
  }
}
