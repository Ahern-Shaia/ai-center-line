import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { resolveTenantFilter } from "../auth/resolve-tenant-id.js";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { LineBotService } from "./line-bot.service.js";
import { LineGroupService } from "./line-group.service.js";
import { LineBotCreateSchema, LineBotUpdateSchema } from "./dto/line-bot.dto.js";

@Controller("line-bots")
export class LineBotController {
  constructor(
    private readonly botSvc: LineBotService,
    private readonly groupSvc: LineGroupService,
  ) {}

  // Refs 給 UI 下拉（tenants + departments）· 放最前避免被 :id 路由吃掉
  // tenantId 選填 · 傳了才 scope departments · aiproot 於 bot detail 頁必傳
  @Get("refs")
  @RequirePermission("line-bots:view")
  async refs(@CurrentUser() user: JwtUser, @Query("tenantId") tenantId?: string) {
    return this.botSvc.getRefs(resolveTenantFilter(user, tenantId));
  }

  // 列表 · tenant_admin 看 own · aiproot_admin / consultant 看全（透過 RLS · 前者 tenant_id 過濾 · 後者 tenant 空看全）
  @Get()
  @RequirePermission("line-bots:view")
  async list() {
    const bots = await this.botSvc.listBots();
    return { bots };
  }

  // 詳情
  @Get(":id")
  @RequirePermission("line-bots:view")
  async get(@Param("id") id: string) {
    const bot = await this.botSvc.getBot(id);
    const groups = await this.groupSvc.listGroupsByBot(id);
    return { bot, groups };
  }

  // 新增 · 只 aiproot_admin
  @Post()
  @RequirePermission("line-bots:create")
  async create(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const parsed = LineBotCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const bot = await this.botSvc.createBot({
      ...parsed.data,
      createdBy: user.user_id,
    });
    return { bot };
  }

  // 編輯 · 只 aiproot_admin
  @Patch(":id")
  @RequirePermission("line-bots:update")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const parsed = LineBotUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const bot = await this.botSvc.updateBot(id, parsed.data);
    return { bot };
  }

  // 停用 · 只 aiproot_admin · soft delete
  @Delete(":id")
  @RequirePermission("line-bots:delete")
  async disable(@Param("id") id: string) {
    await this.botSvc.disableBot(id);
    return { status: "disabled" };
  }

  /** 永久刪除前先看會連帶刪掉什麼（群組／訊息／成員／員工綁定全是 CASCADE） */
  @Get(":id/delete-impact")
  @RequirePermission("line-bots:delete")
  async deleteImpact(@Param("id") id: string) {
    return this.botSvc.deleteImpact(id);
  }

  /**
   * 永久刪除 · 只能刪已停用的。
   * 沒有這個的話，停用的 bot 會永遠留在清單上，而且它佔著 bot_user_id
   * （UNIQUE），同一個 LINE bot 想重新加入也加不了。
   */
  @Delete(":id/permanent")
  @RequirePermission("line-bots:delete")
  async deletePermanently(@Param("id") id: string) {
    await this.botSvc.deleteBotPermanently(id);
    return { status: "deleted" };
  }
}
