import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { RequirePermission } from "./require-permission.decorator.js";
import { TenantCustomRolesService } from "./tenant-custom-roles.service.js";
import { msg } from "../i18n/index.js";

// 租戶自建角色 · docs/modules/custom-roles.md v0.3
//
// 刻意獨立成一個 controller 而不是掛在 /tenant-roles 底下：
// 那邊有 `:roleKey/permissions`、`:roleKey/reset` 這種動態片段，
// 再加 `custom` 進去就要開始擔心路由誰先匹配到誰。分開就沒有這個問題。
//
// ⚠️ tenantId 一律取自 JWT（同 tenant-roles.controller 的理由）——
//    權限碼擋不住跨租戶 IDOR。
@Controller("tenant-custom-roles")
export class TenantCustomRolesController {
  constructor(private readonly svc: TenantCustomRolesService) {}

  private tenantOf(user: JwtUser): string {
    if (!user.tenant_id) {
      throw new BadRequestException(msg("srv.perm.tenantPageOnly"));
    }
    return user.tenant_id;
  }

  /** 本公司自建的角色 */
  @Get()
  @RequirePermission("roles:manage-tenant")
  async list(@CurrentUser() user: JwtUser) {
    return { roles: await this.svc.list(this.tenantOf(user)) };
  }

  /** 可選的資料範圍基準 · 給前端下拉用（文案在這裡定，前端不要自己編一套） */
  @Get("baselines")
  @RequirePermission("roles:manage-tenant")
  baselines() {
    return {
      baselines: [
        { id: "employee", label: "只看自己", hint: "只看得到自己的日報與行程" },
        { id: "group_owner", label: "只看自己部門", hint: "看得到所屬部門的任務與日報 · 指派前要先設好部門" },
        { id: "tenant_admin", label: "看全公司", hint: "看得到全公司所有部門的資料" },
      ],
    };
  }

  /** 建立角色 */
  @Post()
  @RequirePermission("roles:manage-tenant")
  async create(
    @Body() body: { roleName?: string; baselineRole?: string; permissionIds?: string[] },
    @CurrentUser() user: JwtUser,
  ) {
    // 沒有 roleKey —— 那是程式用的識別字，由 service 自動產生（使用者看不到它）
    if (!body?.roleName || !body?.baselineRole) {
      throw new BadRequestException({ status: "missing_field", message: "角色名稱與資料範圍都要填" });
    }
    if (!Array.isArray(body.permissionIds)) {
      throw new BadRequestException({ status: "invalid_permissions", message: "permissionIds 需為陣列" });
    }
    return this.svc.create({
      tenantId: this.tenantOf(user),
      callerUserId: user.user_id,
      roleName: body.roleName,
      baselineRole: body.baselineRole,
      permissionIds: body.permissionIds,
    });
  }

  /** 改這個角色可以做哪些事（全 replace） */
  @Put(":roleId/permissions")
  @RequirePermission("roles:manage-tenant")
  async updatePermissions(
    @Param("roleId") roleId: string,
    @Body() body: { permissionIds?: string[] },
    @CurrentUser() user: JwtUser,
  ) {
    if (!Array.isArray(body?.permissionIds)) {
      throw new BadRequestException({ status: "invalid_permissions", message: "permissionIds 需為陣列" });
    }
    return this.svc.updatePermissions({
      tenantId: this.tenantOf(user),
      callerUserId: user.user_id,
      roleId,
      permissionIds: body.permissionIds,
    });
  }

  /**
   * 指派給某位成員（`roleId: null` ＝ 取消，退回基準角色）。
   *
   * 用 PUT 而不是 PATCH：這是「把某人的自訂角色設成 X」的冪等覆寫，
   * 不是部分更新。重送同一個請求結果一樣。
   */
  @Put("assignments/:userId")
  @RequirePermission("roles:manage-tenant")
  async assign(
    @Param("userId") userId: string,
    @Body() body: { roleId?: string | null },
    @CurrentUser() user: JwtUser,
  ) {
    return this.svc.assign({
      tenantId: this.tenantOf(user),
      callerUserId: user.user_id,
      userId,
      roleId: body?.roleId ?? null,
    });
  }

  @Delete(":roleId")
  @RequirePermission("roles:manage-tenant")
  async remove(@Param("roleId") roleId: string, @CurrentUser() user: JwtUser) {
    await this.svc.remove({ tenantId: this.tenantOf(user), roleId });
    return { ok: true };
  }
}
