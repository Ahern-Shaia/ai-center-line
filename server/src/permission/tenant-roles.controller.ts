import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { RequirePermission } from "./require-permission.decorator.js";
import { TenantRolesService } from "./tenant-roles.service.js";

// 租戶自管角色權限 · docs/modules/tenant-role-permissions.md
//
// 刻意獨立於 /roles（那是 aiproot 的 roles:manage 那套）：
// 兩邊的可見範圍與可寫範圍都不同，共用端點只會讓「誰能改什麼」變得要靠讀 if 才知道。
//
// ⚠️ tenantId 一律取自 JWT，**不收 query / body 傳來的值** ——
//    權限碼擋不住跨租戶 IDOR（見 pitfall_permission_code_is_not_tenant_boundary：
//    2026-07-29 就是 service 用 client 傳的 tenantId 覆蓋掉 interceptor 設好的上下文）。
@Controller("tenant-roles")
export class TenantRolesController {
  constructor(private readonly svc: TenantRolesService) {}

  /**
   * 這幾支端點一定要有租戶身分。
   *
   * `JwtUser.tenant_id` 可以是 null —— aiproot / consultant 不屬於任何租戶。
   * 他們若打進來，代表是走錯端點（aiproot 側有自己的 /roles），
   * 這裡明確擋掉而不是讓 null 往下流成一句看不懂的 SQL 錯誤。
   */
  private tenantOf(user: JwtUser): string {
    if (!user.tenant_id) {
      throw new BadRequestException("這個頁面只給租戶端使用 · AIPROOT 請走「平台 → 權限管理」");
    }
    return user.tenant_id;
  }

  /** 可調整的權限清單 · 只有 tenant / department 級（platform 那 34 項不回傳）*/
  @Get("permissions")
  @RequirePermission("roles:manage-tenant")
  async listPermissions() {
    return { permissions: await this.svc.listPermissions() };
  }

  /** 可調整的角色 · 只有白名單那三個 */
  @Get()
  @RequirePermission("roles:manage-tenant")
  async listRoles(@CurrentUser() user: JwtUser) {
    return { roles: await this.svc.listRoles(this.tenantOf(user)) };
  }

  /** 改某個角色的權限（全 replace）· 第一次改會分岔成本公司專屬 */
  @Patch(":roleKey/permissions")
  @RequirePermission("roles:manage-tenant")
  async updatePermissions(
    @Param("roleKey") roleKey: string,
    @Body() body: { permissionIds?: string[] },
    @CurrentUser() user: JwtUser,
  ) {
    if (!Array.isArray(body?.permissionIds)) {
      throw new BadRequestException("permissionIds 需為陣列");
    }
    return this.svc.updatePermissions({
      tenantId: this.tenantOf(user),
      roleKey,
      permissionIds: body.permissionIds,
    });
  }

  /** 還原成系統預設 */
  @Post(":roleKey/reset")
  @RequirePermission("roles:manage-tenant")
  async reset(@Param("roleKey") roleKey: string, @CurrentUser() user: JwtUser) {
    return this.svc.resetToDefault({ tenantId: this.tenantOf(user), roleKey });
  }
}
