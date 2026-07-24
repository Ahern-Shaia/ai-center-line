import { Body, Controller, HttpCode, NotFoundException, Param, Post } from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";
import { WebhookService } from "./webhook.service.js";

// notify v2 · Ragic 原生 Webhook 入口（每個 config 一個不可猜 token 綁 URL）
// @Public：無 JWT · 認證靠 token（未來加 Ragic 簽章縱深，見 OQ-NSP-1）
@Controller("notify")
export class WebhookController {
  constructor(private readonly svc: WebhookService) {}

  @Post("webhook/:token")
  @Public()
  @HttpCode(200)
  async handle(@Param("token") token: string, @Body() body: unknown) {
    const r = await this.svc.handleWebhook(token, body);
    if (r.status === "not_found") throw new NotFoundException("無效的 webhook token");
    return r;
  }
}
