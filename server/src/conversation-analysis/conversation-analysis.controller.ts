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
/**
 * 分析詳情屬**我方維運視角** —— token 用量、標註工具、原始分類結果，
 * 是拿來調校模型的，不是給客戶看的。客戶要對照原文簽核，走任務卡的「查來源」。
 *
 * ⚠️ 2026-07-28 之前這裡列了 tenant_admin / group_owner，
 * 而前端 (nav.ts canOpenConvoDetail) 只給 aiproot / consultant ——
 * 等於**介面藏起來但 API 開著**。RLS 還在所以不會跨租戶，
 * 但那個門是假的：我們以為擋住了，實際沒有。
 *
 * 日後若某個客戶真的需要，走權限引擎開（roles 表支援 tenant 專屬角色），
 * 不要再把角色寫回這裡。
 */
export const ANALYSIS_ROLES = ["aiproot_admin", "consultant"] as const;

@Controller("conversation-analysis")
export class ConversationAnalysisController {
  constructor(
    private readonly analyze: AnalyzeService,
    private readonly label: LabelService,
  ) {}

  @Post("uploads")
  @Roles(...ANALYSIS_ROLES)
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
  @Roles(...ANALYSIS_ROLES)
  async listUploads() {
    return { uploads: await this.analyze.listUploads() };
  }

  @Get("uploads/:id")
  @Roles(...ANALYSIS_ROLES)
  async getUpload(@Param("id", ParseIntPipe) id: number) {
    const bundle = await this.analyze.getUploadWithResult(id);
    if (!bundle) throw new NotFoundException("upload 不存在或無權限");
    const labels = await this.label.listLabelsForUpload(id);
    return { ...bundle, labels };
  }

  @Post("labels")
  @Roles(...ANALYSIS_ROLES)
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
  @Roles(...ANALYSIS_ROLES)
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
  @Roles(...ANALYSIS_ROLES)
  async getMetrics(@Param("id", ParseIntPipe) id: number) {
    return this.label.getMetrics(id);
  }
}
