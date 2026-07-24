import { Body, Controller, HttpCode, NotFoundException, Param, Post } from "@nestjs/common";
import { Public } from "../../auth/public.decorator.js";
import { RagicWebhookService } from "./ragic-webhook.service.js";

// ragic_form 來源入口 · Ragic 原生 Webhook（每條規則一個不可猜 token）
// @Public：無 JWT · 認證靠 token（Ragic 簽章驗證列後續 hardening · 見 doc caveat）
// 路徑沿用 v2（/notify/webhook/:token）→ 已貼進 Ragic 的 URL 不失效
@Controller("notify")
export class RagicWebhookController {
  constructor(private readonly svc: RagicWebhookService) {}

  @Post("webhook/:token")
  @Public()
  @HttpCode(200)
  async handle(@Param("token") token: string, @Body() body: unknown) {
    const r = await this.svc.handle(token, body);
    if (r.status === "not_found") throw new NotFoundException("無效的 webhook token");
    return r;
  }
}
