import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { UploadCreateSchema } from "./dto/upload.dto.js";
import { LabelCreateSchema } from "./dto/label.dto.js";
import { AnalyzeService } from "./analyze.service.js";
import { LabelService } from "./label.service.js";

// 對話分析 pilot · 全部走 JWT auth + roles guard
// Roles 四種都可 label（差異在能看/label 哪些 upload · 由 tenant tx RLS 隔離）
@Controller("conversation-analysis")
export class ConversationAnalysisController {
  constructor(
    private readonly analyze: AnalyzeService,
    private readonly label: LabelService,
  ) {}

  @Post("uploads")
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner")
  async createUpload(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const parsed = UploadCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return this.analyze.createUpload(parsed.data, user.user_id, user.tenant_id ?? null);
  }

  @Get("uploads")
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner")
  async listUploads() {
    return { uploads: await this.analyze.listUploads() };
  }

  @Get("uploads/:id")
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner")
  async getUpload(@Param("id", ParseIntPipe) id: number) {
    const bundle = await this.analyze.getUploadWithResult(id);
    if (!bundle) throw new NotFoundException("upload 不存在或無權限");
    const labels = await this.label.listLabelsForUpload(id);
    return { ...bundle, labels };
  }

  @Post("labels")
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner")
  async createLabel(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const parsed = LabelCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return this.label.createLabel(parsed.data, user.user_id);
  }

  @Delete("labels")
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner")
  async deleteLabel(
    @CurrentUser() user: JwtUser,
    @Query("uploadId", ParseIntPipe) uploadId: number,
    @Query("targetType") targetType: string,
    @Query("targetId") targetId: string,
  ) {
    if (!["classification", "daily_report", "record"].includes(targetType)) {
      throw new BadRequestException("targetType 需為 classification/daily_report/record");
    }
    await this.label.deleteLabel(uploadId, targetType, targetId, user.user_id);
    return { status: "deleted" };
  }

  @Get("uploads/:id/metrics")
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner")
  async getMetrics(@Param("id", ParseIntPipe) id: number) {
    return this.label.getMetrics(id);
  }
}
