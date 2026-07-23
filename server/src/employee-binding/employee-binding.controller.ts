import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { withTenant } from "../db/client.js";
import { EmployeeBindingService } from "./employee-binding.service.js";
import { UserLineBindingRepository } from "./user-line-binding.repository.js";
import { NudgeService } from "./nudge.service.js";

/**
 * Employee Binding Controller · 方向 8 LIFF Zero-Config
 *
 * LIFF endpoints (公開 · 由 LINE App 內開啟 · 用 lineUserId 驗證 · 無需 JWT)：
 *   GET  /binding/liff/prefill · Alice 打開 LIFF 時撈 pre-fill 資料
 *   POST /binding/liff/complete · Alice 確認綁定
 *
 * Aiproot admin endpoints:
 *   GET  /binding/aiproot/list · 列全 tenant binding audit
 *   POST /binding/aiproot/revoke/:bindingId · 撤銷某 binding
 *
 * Alice 個人 endpoint:
 *   POST /binding/self/revoke · Alice 自撤銷
 */
@Controller("binding")
export class EmployeeBindingController {
  constructor(
    private readonly svc: EmployeeBindingService,
    private readonly bindingRepo: UserLineBindingRepository,
    private readonly nudge: NudgeService,
  ) {}

  /**
   * LIFF pre-fill · 公開 endpoint
   * 由 LIFF WebView 打開後呼叫 · SDK 提供 lineUserId · botId 由 LIFF URL 帶入
   * 安全 · lineUserId 從 LIFF SDK 拿 · 是 LINE 保證的技術認證
   */
  @Public()
  @Get("liff/prefill")
  async liffPrefill(@Query("botId") botId: string, @Query("lineUserId") lineUserId: string) {
    if (!botId || !lineUserId) {
      throw new BadRequestException("botId 和 lineUserId 必要");
    }
    if (!isValidUuid(botId)) {
      throw new BadRequestException("botId 格式錯 · 需為 UUID");
    }
    return this.svc.getLiffPrefill(botId, lineUserId);
  }

  /**
   * LIFF 完成綁定 · 公開 endpoint
   * Body: { botId, lineUserId, displayName, primaryGroupId?, metadata? }
   */
  @Public()
  @Post("liff/set-password")
  async liffSetPassword(@Body() body: {
    botId?: string;
    lineUserId?: string;
    email?: string;
    password?: string;
  }) {
    // Option C · Alice 綁定後可自設 email + 密碼 · 提供 email 登入備援
    if (!body?.botId || !body?.lineUserId || !body?.email || !body?.password) {
      throw new BadRequestException("botId, lineUserId, email, password 必要");
    }
    if (!isValidUuid(body.botId)) {
      throw new BadRequestException("botId 格式錯 · 需為 UUID");
    }
    return this.svc.setPasswordViaLiff({
      botId: body.botId,
      lineUserId: body.lineUserId,
      email: body.email,
      password: body.password,
    });
  }

  @Public()
  @Post("liff/complete")
  async liffComplete(@Body() body: {
    botId?: string;
    lineUserId?: string;
    displayName?: string;
    metadata?: Record<string, unknown>;
  }) {
    // v2 · 只需 botId + lineUserId + displayName · 部門由後端 derive (不接受 primaryGroupId)
    if (!body?.botId || !body?.lineUserId || !body?.displayName) {
      throw new BadRequestException("botId, lineUserId, displayName 必要");
    }
    if (!isValidUuid(body.botId)) {
      throw new BadRequestException("botId 格式錯 · 需為 UUID");
    }
    return this.svc.completeLiffBinding({
      botId: body.botId,
      lineUserId: body.lineUserId,
      displayName: body.displayName,
      metadata: body.metadata ?? {},
    });
  }

  /**
   * Aiproot audit 頁 · 列 tenant 底下 binding (active + revoked)
   */
  @Get("aiproot/list")
  @Roles("aiproot_admin", "consultant")
  async aiprootList(@Query("tenantId") tenantId?: string, @Query("status") status?: "active" | "revoked") {
    if (!tenantId) throw new BadRequestException("tenantId 必要");
    const rows = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.bindingRepo.listByTenant(tx, tenantId, { status, limit: 500 }));
    return { bindings: rows };
  }

  /**
   * Aiproot revoke · 撤銷某 binding
   */
  @Post("aiproot/revoke/:bindingId")
  @Roles("aiproot_admin")
  async aiprootRevoke(
    @Param("bindingId") bindingId: string,
    @CurrentUser() user: JwtUser,
    @Body() body: { reason?: string } = {},
  ) {
    await this.svc.revokeBinding(bindingId, user.user_id, "aiproot_revoke");
    return { success: true };
  }

  /**
   * Tenant 自治 · tenant_admin 列自租戶 binding audit
   * · tenantId 一律取自 JWT（user.tenant_id）· 不接受 query 傳入 · 防跨租戶窺看
   * · 在 tenant_admin 上下文執行 · user_line_binding + users RLS 皆已 tenant-scope
   */
  @Get("tenant/list")
  @Roles("tenant_admin")
  async tenantList(@CurrentUser() user: JwtUser, @Query("status") status?: "active" | "revoked") {
    const tenantId = user.tenant_id;
    if (!tenantId) throw new BadRequestException("缺租戶識別");
    const rows = await withTenant({ tenantId, role: "tenant_admin" }, (tx) => this.bindingRepo.listByTenant(tx, tenantId, { status, limit: 500 }));
    return { bindings: rows };
  }

  /**
   * Tenant 自治 · tenant_admin 撤銷自租戶員工綁定
   * · 跨租戶 binding_id 由 RLS 擋死（service 內在 tenant 上下文執行）
   */
  @Post("tenant/revoke/:bindingId")
  @Roles("tenant_admin")
  async tenantRevoke(@Param("bindingId") bindingId: string, @CurrentUser() user: JwtUser) {
    if (!user.tenant_id) throw new BadRequestException("缺租戶識別");
    if (!isValidUuid(bindingId)) throw new BadRequestException("bindingId 格式錯 · 需為 UUID");
    await this.svc.revokeBindingForTenant(bindingId, user.tenant_id, user.user_id);
    return { success: true };
  }

  /**
   * Tenant 自治 · tenant_admin 看自租戶未綁定活躍者
   */
  @Get("tenant/unbound-stats")
  @Roles("tenant_admin")
  async tenantUnboundStats(@CurrentUser() user: JwtUser) {
    if (!user.tenant_id) throw new BadRequestException("缺租戶識別");
    return { stats: await this.nudge.computeUnboundStatsForTenant(user.tenant_id) };
  }

  /**
   * Alice self-revoke · 需登入（但 tenant_admin/group_owner 都可撤自己的）
   */
  @Post("self/revoke")
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner")
  async selfRevoke(@CurrentUser() user: JwtUser) {
    const binding = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.bindingRepo.getActiveByUserId(tx, user.user_id));
    if (!binding) throw new BadRequestException("你沒有 active binding");
    await this.svc.revokeBinding(binding.bindingId, user.user_id, "self_revoke");
    return { success: true };
  }

  /**
   * Aiproot 手動觸發 nudge 掃描 · 顯每 tenant 未綁定活躍者
   */
  @Get("aiproot/unbound-stats")
  @Roles("aiproot_admin", "consultant")
  async unboundStats() {
    return { stats: await this.nudge.computeUnboundStats() };
  }
}

// UUID v4 pattern · 8-4-4-4-12 hex · defensive check 避免 SQL 22P02
function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
