import { Controller, HttpCode, Post, RawBodyRequest, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Public } from "../auth/public.decorator.js";
import { LineWebhookService } from "./line-webhook.service.js";

@Controller("line")
export class LineWebhookController {
  constructor(private readonly svc: LineWebhookService) {}

  // Public endpoint · 靠 HMAC 驗簽 · 一律 return 200（LINE 3s timeout）
  @Public()
  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<FastifyRequest>) {
    const rawBody = req.rawBody?.toString("utf8") ?? "";
    const sigHeader = req.headers["x-line-signature"];
    const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader ?? "";
    await this.svc.processWebhook(rawBody, sig);
    return { ok: true };
  }
}
