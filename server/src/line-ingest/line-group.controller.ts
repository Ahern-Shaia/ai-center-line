import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { LineGroupService } from "./line-group.service.js";
import { LineGroupPatchSchema } from "./dto/line-bot.dto.js";

// LINE 群組 · v2 分權：
//   · patch (分派 dept / rename / toggle analyze) · line-groups:assign (tenant scope · tenant_admin + aiproot)
//   · probe (拉 LINE 群名) · line-groups:probe (tenant scope · tenant_admin + aiproot)
// 對照 docs/roles-permissions-matrix.md §3.4
@Controller("line-groups")
export class LineGroupController {
  constructor(private readonly svc: LineGroupService) {}

  // list 自 tenant 所有 group · tenant_admin「LINE 群組」頁用
  @Get()
  @RequirePermission("line-groups:view")
  async list(@CurrentUser() user: JwtUser) {
    if (!user.tenant_id) {
      throw new BadRequestException("需綁定 tenant");
    }
    const groups = await this.svc.listGroupsByTenant(user.tenant_id);
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
