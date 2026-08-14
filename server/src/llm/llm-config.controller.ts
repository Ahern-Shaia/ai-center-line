import { BadRequestException, Body, Controller, Delete, Get, Param, Put, Query } from "@nestjs/common";
import { resolveTenantId } from "../auth/resolve-tenant-id.js";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { LlmConfigUpsertSchema } from "./dto/llm-config.dto.js";
import { LlmConfigService } from "./llm-config.service.js";
import { PROVIDER_DEFAULT_MODELS, platformDefaultModel } from "./provider.factory.js";

/**
 * LLM config · aiproot 統管 · 客戶端看不到
 *
 * 產品原則（2026-07-22 用戶明訂）：
 *   LLM 是「戰情室平台大腦」· aiproot 幫每 tenant 代設 · 就跟 LINE bot 一樣
 *   客戶（tenant_admin / group_owner）看不到管理面 · 只看戰情室 + 稽核
 *
 * Fallback 順序（AnalyzeService.resolveProvider）：
 *   1. tenant_llm_config 有 row → 用該 provider/model/key
 *   2. 無 → 走 env ANTHROPIC_API_KEY + env LLM_DEFAULT_MODEL（平台預設 · aiproot 自付 API 費）
 *      LLM_DEFAULT_MODEL 未設時沿用 provider.factory 的 fallback 常數
 */
@Controller("llm-config")
export class LlmConfigController {
  constructor(private readonly svc: LlmConfigService) {}

  // GET /llm-config?tenantId=xxx
  @Get()
  @RequirePermission("llm-config:view")
  async get(@CurrentUser() user: JwtUser, @Query("tenantId") tenantId?: string) {
    const cfg = await this.svc.getMasked(resolveTenantId(user, tenantId));
    return {
      config: cfg,
      providerModels: PROVIDER_DEFAULT_MODELS,
      // 前端顯示「此租戶未設定時實際會用什麼」· 不要在 UI 寫死模型名（會跟 env 脫節）
      platformDefault: {
        provider: "anthropic" as const,
        model: platformDefaultModel(),
        apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      },
    };
  }

  // PUT /llm-config  body: { tenantId, provider, model, apiKey, ... }
  @Put()
  @RequirePermission("llm-config:manage")
  async put(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const b = body as { tenantId?: string; [k: string]: unknown };
    if (!b?.tenantId || typeof b.tenantId !== "string") {
      throw new BadRequestException("body.tenantId 必要");
    }
    const { tenantId, ...rest } = b;
    const parsed = LlmConfigUpsertSchema.safeParse(rest);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return this.svc.saveConfig(tenantId, parsed.data, user.user_id);
  }

  // DELETE /llm-config/:tenantId · 清 tenant config · 讓 fallback env
  @Delete(":tenantId")
  @RequirePermission("llm-config:manage")
  async remove(@Param("tenantId") tenantId: string) {
    return this.svc.deleteConfig(tenantId);
  }
}
