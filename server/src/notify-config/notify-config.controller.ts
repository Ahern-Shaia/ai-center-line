import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { RagicAccountService } from "../ragic/ragic-account.service.js";
import { NotifyConfigService, type CreateRuleInput } from "./notify-config.service.js";
import { HubAuditRepository } from "../notification-hub/audit.repository.js";
import { resolveTenantId } from "../auth/resolve-tenant-id.js";

// aiproot「通知設定」API · 通用規則（來源/管道無關）
// 全掛 permission gate（notify-config:view/manage · 給 aiproot_admin+consultant）
// 對照 docs/modules/notification-hub.md
@Controller("notify-config")
export class NotifyConfigController {
  constructor(
    private readonly accounts: RagicAccountService,
    private readonly configs: NotifyConfigService,
    private readonly audit: HubAuditRepository,
  ) {}

  // ===== 來源：Ragic 帳號 =====
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

  /** 只改顯示名稱 · server / apname 是連線識別，改了等於換一個帳號，不開放 */
  @Post("accounts/:id/name")
  @RequirePermission("notify-config:manage")
  renameAccount(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body() body: { displayName?: string }) {
    return this.accounts.rename(user, id, body.displayName ?? "");
  }

  /** Ragic 表單欄位（勾選用）· 同時驗 key */
  @Get("accounts/:id/fields")
  @RequirePermission("notify-config:manage")
  fields(@Param("id") id: string, @Query("sheetPath") sheetPath?: string) {
    return this.accounts.fetchSheetFields(id, sheetPath ?? "");
  }

  /**
   * 可選的「發送機器人 + 該機器人所在的群組」· 精靈第 3 步的資料來源。
   * 群組依 bot 過濾 → 使用者挑不到別支 bot 的群（LINE 群組 ID 依 bot 發放）。
   */
  @Get("sendable-targets")
  @RequirePermission("notify-config:view")
  sendableTargets() {
    return this.configs.listSendableTargets();
  }

  /**
   * 這個群組屬於哪支 bot？逐支 active bot 問 LINE。
   * 用於補既有規則：`line_group` 只在收過 webhook 事件時才有紀錄，
   * bot 若在 webhook 設好前就進群，我方完全沒有那個群的資料。
   */
  @Get("which-bot-in-group")
  @RequirePermission("notify-config:manage")
  whichBot(@Query("groupId") groupId?: string) {
    if (!groupId?.trim()) throw new BadRequestException("需帶 groupId");
    return this.configs.whichBotIsInGroup(groupId.trim());
  }

  // ===== 來源：內部事件型錄 =====
  @Get("event-catalog")
  @RequirePermission("notify-config:view")
  eventCatalog() {
    return this.configs.eventCatalog();
  }

  // ===== 管道對象 =====
  /**
   * 目標群下拉的資料來源。
   *
   * ⚠️ 不吃任何 client 傳的租戶參數 —— 範圍完全交給 line_group 的 RLS 決定，
   *    所以這裡沒有 IDOR 的面（同 pitfall_permission_code_is_not_tenant_boundary）。
   *
   * ⚠️ **這條必須留在 `@Get(":id")` 前面**（本檔第 130 行附近）。
   *    Nest 依宣告順序註冊，搬到下面就會被 `:id` 吃掉，變成 id="line-groups"
   *    去查規則 → 回 404「找不到規則」。而且**無權限時兩者都回 401**，
   *    光看狀態碼分不出被吃掉了，要登入才會發現。
   */
  @Get("line-groups")
  @RequirePermission("notify-config:view")
  allLineGroups() {
    return this.configs.listAllLineGroups();
  }

  /** 可私訊的成員（已綁 LINE）· tenantId 選填，未帶用自己的 */
  @Get("notifiable-users")
  @RequirePermission("notify-config:view")
  notifiableUsers(@CurrentUser() user: JwtUser, @Query("tenantId") tenantId?: string) {
    // ⚠️ 原本是 `tenantId || user.tenant_id` —— 非平台角色傳別家 id 就照收
    const t = resolveTenantId(user, tenantId);
    return this.configs.listNotifiableUsers(t);
  }

  // ===== 通知紀錄（排查）=====
  /** 最近通知紀錄 · 用來回答「Ragic 改了為什麼沒通知」——有沒有進來、進來後被什麼擋掉 */
  @Get("logs")
  @RequirePermission("notify-config:view")
  logs(@Query("limit") limit?: string, @Query("ruleId") ruleId?: string, @Query("status") status?: string) {
    const n = Number(limit);
    return this.audit.listRecent({
      limit: Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50,
      ruleId: ruleId || null,
      status: status || null,
    });
  }

  // ===== 規則 =====
  @Get()
  @RequirePermission("notify-config:view")
  list() {
    return this.configs.listRules();
  }

  @Post()
  @RequirePermission("notify-config:manage")
  create(@CurrentUser() user: JwtUser, @Body() body: Partial<CreateRuleInput>) {
    if (body.sourceType !== "ragic_form" && body.sourceType !== "internal_event") {
      throw new BadRequestException("sourceType 需為 ragic_form | internal_event");
    }
    if (!body.channelType || !["line_group", "line_user"].includes(body.channelType)) {
      throw new BadRequestException("channelType 目前支援 line_group | line_user");
    }
    return this.configs.createRule(user, {
      name: body.name?.trim() ?? "",
      sourceType: body.sourceType,
      ragicAccountId: body.ragicAccountId,
      sheetPath: body.sheetPath,
      sheetName: body.sheetName,
      notifyCreate: body.notifyCreate,
      notifyUpdate: body.notifyUpdate,
      notifyDelete: body.notifyDelete,
      eventType: body.eventType,
      filters: body.filters,
      title: body.title ?? null,
      fields: body.fields ?? [],
      channelType: body.channelType,
      channelTarget: body.channelTarget ?? "",
    });
  }

  @Get(":id")
  @RequirePermission("notify-config:view")
  detail(@Param("id") id: string) {
    return this.configs.getRuleDetail(id);
  }

  /**
   * 編輯規則 · 可改名稱／觸發事件／欄位／標題／通知對象。
   * 表單路徑與 webhook 網址不可改 —— 網址已貼在客戶的 Ragic 那側，
   * 改了通知會悄悄停掉而客戶不會知道。要換表單請新增一條規則。
   */
  @Patch(":id")
  @RequirePermission("notify-config:manage")
  update(@Param("id") id: string, @Body() body: {
    name?: string; title?: string | null;
    notifyCreate?: boolean; notifyUpdate?: boolean; notifyDelete?: boolean;
    fields?: Array<{ path: string | number; label: string; order: number }>;
    channelType?: string; channelTarget?: string;
    botId?: string;
  }) {
    return this.configs.updateRule(id, body);
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
