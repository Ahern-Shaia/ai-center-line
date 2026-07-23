import { BadRequestException, Body, Controller, Param, Patch, Post } from "@nestjs/common";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { LineGroupService } from "./line-group.service.js";
import { LineGroupPatchSchema } from "./dto/line-bot.dto.js";

// LINE 群組 · v2 分權：
//   · patch (分派 dept / rename / toggle analyze) · line-groups:assign (tenant scope · tenant_admin + aiproot)
//   · probe (拉 LINE 群名) · line-groups:probe (tenant scope · tenant_admin + aiproot)
// 對照 docs/roles-permissions-matrix.md §3.4
@Controller("line-groups")
export class LineGroupController {
  constructor(private readonly svc: LineGroupService) {}

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
