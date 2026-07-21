import { BadRequestException, Body, Controller, Param, Patch, Post } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { LineGroupService } from "./line-group.service.js";
import { LineGroupPatchSchema } from "./dto/line-bot.dto.js";

@Controller("line-groups")
export class LineGroupController {
  constructor(private readonly svc: LineGroupService) {}

  // 分派 department / 更新 displayName / analyzeEnabled
  @Patch(":groupRegistryId")
  @Roles("aiproot_admin", "consultant", "tenant_admin")
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
  @Roles("aiproot_admin", "consultant", "tenant_admin")
  async probeName(@Param("groupRegistryId") id: string) {
    return this.svc.probeDisplayName(id);
  }
}
