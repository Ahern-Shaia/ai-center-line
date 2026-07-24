import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { RagicAccountService } from "./ragic-account.service.js";
import { NotifyConfigService } from "./notify-config.service.js";
import type { NotifyConfigField } from "../db/schema.js";

// notify v2 aiproot 設定 API · 全掛 permission gate（notify-config:view/manage · 給 aiproot_admin+consultant）
// 對照 docs/modules/notify-selfserve-platform.md §4-bis
@Controller("notify-config")
export class NotifyConfigController {
  constructor(
    private readonly accounts: RagicAccountService,
    private readonly configs: NotifyConfigService,
  ) {}

  // ===== Ragic 帳號 =====
  @Get("accounts")
  @RequirePermission("notify-config:view")
  listAccounts() {
    return this.accounts.listAccounts();
  }

  @Post("accounts")
  @RequirePermission("notify-config:manage")
  createAccount(@CurrentUser() user: JwtUser, @Body() body: {
    tenantId?: string | null; server?: string; apname?: string; displayName?: string; apiKey?: string;
  }) {
    return this.accounts.createAccount(user, {
      tenantId: body.tenantId ?? null,
      server: body.server ?? "",
      apname: body.apname ?? "",
      displayName: body.displayName ?? "",
      apiKey: body.apiKey,
    });
  }

  @Post("accounts/:id/key")
  @RequirePermission("notify-config:manage")
  updateKey(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body() body: { apiKey?: string }) {
    return this.accounts.updateKey(user, id, body.apiKey ?? "");
  }

  // 抓表單欄位（給前端勾選）· 同時驗 key
  @Get("accounts/:id/fields")
  @RequirePermission("notify-config:manage")
  fields(@Param("id") id: string, @Query("sheetPath") sheetPath?: string) {
    return this.accounts.fetchSheetFields(id, sheetPath ?? "");
  }

  @Get("accounts/:id/line-groups")
  @RequirePermission("notify-config:view")
  lineGroups(@Param("id") id: string) {
    return this.configs.listLineGroupsForAccount(id);
  }

  // ===== 通知設定 =====
  @Get()
  @RequirePermission("notify-config:view")
  list() {
    return this.configs.listConfigs();
  }

  @Post()
  @RequirePermission("notify-config:manage")
  create(@CurrentUser() user: JwtUser, @Body() body: {
    ragicAccountId?: string; sheetPath?: string; sheetName?: string; title?: string | null;
    fields?: NotifyConfigField[]; notifyCreate?: boolean; notifyUpdate?: boolean; notifyDelete?: boolean; lineGroupId?: string;
  }) {
    if (!body.ragicAccountId || !body.sheetPath?.trim() || !body.sheetName?.trim() || !body.lineGroupId?.trim()) {
      throw new BadRequestException("ragicAccountId / sheetPath / sheetName / lineGroupId 必填");
    }
    if (!Array.isArray(body.fields) || body.fields.length === 0) {
      throw new BadRequestException("至少勾選一個欄位");
    }
    return this.configs.createConfig(user, {
      ragicAccountId: body.ragicAccountId,
      sheetPath: body.sheetPath.trim(),
      sheetName: body.sheetName.trim(),
      title: body.title?.trim() || null,
      fields: body.fields,
      notifyCreate: body.notifyCreate ?? true,
      notifyUpdate: body.notifyUpdate ?? true,
      notifyDelete: body.notifyDelete ?? false,
      lineGroupId: body.lineGroupId.trim(),
    });
  }

  @Patch(":id/enabled")
  @RequirePermission("notify-config:manage")
  setEnabled(@Param("id") id: string, @Body() body: { enabled?: boolean }) {
    return this.configs.setEnabled(id, body.enabled === true);
  }

  @Delete(":id")
  @RequirePermission("notify-config:manage")
  remove(@Param("id") id: string) {
    return this.configs.remove(id);
  }
}
