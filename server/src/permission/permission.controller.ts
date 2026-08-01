import { BadRequestException, Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { RequirePermission } from "./require-permission.decorator.js";
import { PermissionService } from "./permission.service.js";
import { AllowAnyUser } from "../auth/allow-any-user.decorator.js";

@Controller()
export class PermissionController {
  constructor(private readonly svc: PermissionService) {}

  // GET /me/permissions · 目前登入使用者的 permission set
  @Get("me/permissions")
  @AllowAnyUser()
  async myPermissions(@CurrentUser() user: JwtUser) {
    const [perms, displayName] = await Promise.all([
      this.svc.getUserPermissions(user.user_id),
      this.svc.getDisplayName(user.user_id),
    ]);
    return { permissions: Array.from(perms), displayName };
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

  // ==================================================================
  // Phase 2 · Custom role management (aiproot only for now)
  // ==================================================================

  // POST /roles · 建 custom role
  @Post("roles")
  @RequirePermission("roles:manage")
  async createRole(@Body() body: {
    roleKey?: string;
    roleName?: string;
    tenantId?: string | null;
    permissionIds?: string[];
  }) {
    if (!body?.roleKey || !body?.roleName) {
      throw new BadRequestException("roleKey 和 roleName 必要");
    }
    if (!/^[a-z][a-z0-9_-]{0,50}$/.test(body.roleKey)) {
      throw new BadRequestException("roleKey 需 lowercase · 開頭字母 · 只允許 a-z 0-9 _ -");
    }
    return this.svc.createCustomRole({
      roleKey: body.roleKey,
      roleName: body.roleName,
      tenantId: body.tenantId ?? null,
      permissionIds: body.permissionIds ?? [],
    });
  }

  // PATCH /roles/:id/permissions · 更新 role 的 perm set (全 replace)
  @Patch("roles/:roleId/permissions")
  @RequirePermission("roles:manage")
  async updateRolePermissions(
    @Param("roleId") roleId: string,
    @Body() body: { permissionIds?: string[] },
  ) {
    if (!Array.isArray(body?.permissionIds)) {
      throw new BadRequestException("permissionIds 需為 array");
    }
    await this.svc.updateRolePermissions(roleId, body.permissionIds);
    return { success: true };
  }

  // PATCH /roles/:id · 改名 (只 custom)
  @Patch("roles/:roleId")
  @RequirePermission("roles:manage")
  async renameRole(@Param("roleId") roleId: string, @Body() body: { roleName?: string }) {
    if (!body?.roleName) throw new BadRequestException("roleName 必要");
    await this.svc.renameRole(roleId, body.roleName);
    return { success: true };
  }

  // DELETE /roles/:id · 刪 custom role (system 不可刪)
  @Delete("roles/:roleId")
  @RequirePermission("roles:manage")
  async deleteRole(@Param("roleId") roleId: string) {
    try {
      await this.svc.deleteRole(roleId);
      return { success: true };
    } catch (err) {
      throw new HttpException((err as Error).message, HttpStatus.BAD_REQUEST);
    }
  }

  // POST /users/:userId/assign-role · 指派 role 給 user (aiproot 全能)
  @Post("users/:userId/assign-role")
  @RequirePermission("roles:manage", "users:manage")
  async assignRole(
    @Param("userId") userId: string,
    @Body() body: { roleId?: string },
  ) {
    if (!body?.roleId) throw new BadRequestException("roleId 必要");
    await this.svc.assignRoleToUser(userId, body.roleId);
    return { success: true };
  }
}
