import { BadRequestException, Body, Controller, Get, NotFoundException, Put } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { LlmConfigUpsertSchema } from "./dto/llm-config.dto.js";
import { LlmConfigService } from "./llm-config.service.js";
import { PROVIDER_DEFAULT_MODELS } from "./provider.factory.js";

@Controller("llm-config")
export class LlmConfigController {
  constructor(private readonly svc: LlmConfigService) {}

  @Get()
  @Roles("aiproot_admin", "consultant", "tenant_admin")
  async get(@CurrentUser() user: JwtUser) {
    if (!user.tenant_id) {
      throw new NotFoundException("aiproot 需明確帶 tenant_id · 目前不支援跨租戶 read（pilot）");
    }
    const cfg = await this.svc.getMasked(user.tenant_id);
    return {
      config: cfg,
      providerModels: PROVIDER_DEFAULT_MODELS,
    };
  }

  @Put()
  @Roles("aiproot_admin", "consultant", "tenant_admin")
  async put(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const parsed = LlmConfigUpsertSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (!user.tenant_id) {
      throw new BadRequestException("aiproot 需明確帶 tenant_id（pilot 階段不支援跨租戶寫）");
    }
    return this.svc.saveConfig(user.tenant_id, parsed.data, user.user_id);
  }
}
