import { BadRequestException, Body, Controller, HttpCode, InternalServerErrorException, Post, Req, UseGuards } from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";
import { WebhookSecretGuard, type NotifyRequest } from "./webhook-secret.guard.js";
import { NotifyService, type HandleResult } from "./notify.service.js";
import { RagicMaintenanceReportSchema } from "./dto/ragic-maintenance-report.dto.js";
import { RagicAnalysisSheetSchema } from "./dto/ragic-analysis-sheet.dto.js";
import { RagicQuotationSchema } from "./dto/ragic-quotation.dto.js";
import { RagicMaterialInspectionSchema } from "./dto/ragic-material-inspection.dto.js";

@Controller("notify/ragic")
export class NotifyController {
  constructor(private readonly svc: NotifyService) {}

  // @Public() = 跳過 JwtAuthGuard；@UseGuards(WebhookSecretGuard) = 走 X-Notify-Secret 驗簽並附掛 req.tenant
  // 不走 TenantTxInterceptor（沒有 req.user）→ notify.repository 用 raw db 寫 audit
  @Post("maintenance-report")
  @Public()
  @UseGuards(WebhookSecretGuard)
  @HttpCode(200)
  async maintenanceReport(
    @Req() req: NotifyRequest,
    @Body() body: unknown,
  ): Promise<HandleResult & { status: string }> {
    const tenant = req.tenant;
    if (!tenant) {
      // Guard 通過的話 req.tenant 一定存在；防禦性檢查
      throw new InternalServerErrorException("guard 未設 req.tenant");
    }
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
    return this.svc.handleMaintenanceReport(tenant, parsed.data);
  }

  @Post("analysis-sheet")
  @Public()
  @UseGuards(WebhookSecretGuard)
  @HttpCode(200)
  async analysisSheet(
    @Req() req: NotifyRequest,
    @Body() body: unknown,
  ): Promise<HandleResult & { status: string }> {
    const tenant = req.tenant;
    if (!tenant) {
      throw new InternalServerErrorException("guard 未設 req.tenant");
    }
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
    return this.svc.handleAnalysisSheet(tenant, parsed.data);
  }

  @Post("quotation")
  @Public()
  @UseGuards(WebhookSecretGuard)
  @HttpCode(200)
  async quotation(
    @Req() req: NotifyRequest,
    @Body() body: unknown,
  ): Promise<HandleResult & { status: string }> {
    const tenant = req.tenant;
    if (!tenant) {
      throw new InternalServerErrorException("guard 未設 req.tenant");
    }
    const parsed = RagicQuotationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    return this.svc.handleQuotation(tenant, parsed.data);
  }

  @Post("material-inspection")
  @Public()
  @UseGuards(WebhookSecretGuard)
  @HttpCode(200)
  async materialInspection(
    @Req() req: NotifyRequest,
    @Body() body: unknown,
  ): Promise<HandleResult & { status: string }> {
    const tenant = req.tenant;
    if (!tenant) {
      throw new InternalServerErrorException("guard 未設 req.tenant");
    }
    const parsed = RagicMaterialInspectionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    return this.svc.handleMaterialInspection(tenant, parsed.data);
  }
}
