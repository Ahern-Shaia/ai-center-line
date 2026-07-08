import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";
import { WebhookSecretGuard } from "./webhook-secret.guard.js";
import { NotifyService, type HandleResult } from "./notify.service.js";
import { RagicMaintenanceReportSchema } from "./dto/ragic-maintenance-report.dto.js";
import { RagicAnalysisSheetSchema } from "./dto/ragic-analysis-sheet.dto.js";

@Controller("notify/ragic")
export class NotifyController {
  constructor(private readonly svc: NotifyService) {}

  // @Public() = 跳過 JwtAuthGuard；@UseGuards(WebhookSecretGuard) = 走 X-Notify-Secret 驗簽
  // 不走 TenantTxInterceptor（沒有 req.user）→ notify.repository 用 raw db 寫 audit
  @Post("maintenance-report")
  @Public()
  @UseGuards(WebhookSecretGuard)
  @HttpCode(200)
  async maintenanceReport(@Body() body: unknown): Promise<HandleResult & { status: string }> {
    const parsed = RagicMaintenanceReportSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    return this.svc.handleMaintenanceReport(parsed.data);
  }

  @Post("analysis-sheet")
  @Public()
  @UseGuards(WebhookSecretGuard)
  @HttpCode(200)
  async analysisSheet(@Body() body: unknown): Promise<HandleResult & { status: string }> {
    const parsed = RagicAnalysisSheetSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    return this.svc.handleAnalysisSheet(parsed.data);
  }
}
