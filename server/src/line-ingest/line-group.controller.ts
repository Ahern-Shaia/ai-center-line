import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { resolveTenantId } from "../auth/resolve-tenant-id.js";
import { LineGroupService } from "./line-group.service.js";
import { LineGroupPatchSchema } from "./dto/line-bot.dto.js";

// LINE 群組 · v2 分權：
//   · patch (分派 dept / rename / toggle analyze) · line-groups:assign (tenant scope · tenant_admin + aiproot)
//   · probe (拉 LINE 群名) · line-groups:probe (tenant scope · tenant_admin + aiproot)
// 對照 docs/roles-permissions-matrix.md §3.4
@Controller("line-groups")
export class LineGroupController {
  constructor(private readonly svc: LineGroupService) {}

  /**
   * 列出某租戶的所有群組。
   *
   * ⚠️ 原本直接用 `user.tenant_id`，而 aiproot 沒有租戶 —— 於是平台端點開了
   * 「通訊管道」卻什麼都看不到（前端因為 session.tenantId 為 null 直接不發請求，
   * 連錯誤都沒有，就是一片空白）。改用 resolveTenantId：平台角色帶 tenantId
   * 指定要看哪一家，客戶端一律用自己的、傳別家直接擋。
   */
  @Get()
  @RequirePermission("line-groups:view")
  async list(@CurrentUser() user: JwtUser, @Query("tenantId") tenantId?: string) {
    const groups = await this.svc.listGroupsByTenant(resolveTenantId(user, tenantId));
    return { groups };
  }

  // 分派 department / 更新 displayName / analyzeEnabled
  @Patch(":groupRegistryId")
  @RequirePermission("line-groups:assign")
  async patch(@Param("groupRegistryId") id: string, @Body() body: unknown) {
    const parsed = LineGroupPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const group = await this.svc.patchGroup(id, parsed.data);
    return { group };
  }

  // 手動觸發 LINE API 拉群名稱
  @Post(":groupRegistryId/probe-name")
  @RequirePermission("line-groups:probe")
  async probeName(@Param("groupRegistryId") id: string) {
    return this.svc.probeDisplayName(id);
  }
}
