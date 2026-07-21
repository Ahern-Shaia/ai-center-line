import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
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
  @Get("refs")
  @Roles("aiproot_admin", "consultant")
  async refs() {
    return this.botSvc.getRefs();
  }

  // 列表 · tenant_admin 看 own · aiproot_admin / consultant 看全（透過 RLS · 前者 tenant_id 過濾 · 後者 tenant 空看全）
  @Get()
  @Roles("aiproot_admin", "consultant")
  async list() {
    const bots = await this.botSvc.listBots();
    return { bots };
  }

  // 詳情
  @Get(":id")
  @Roles("aiproot_admin", "consultant")
  async get(@Param("id") id: string) {
    const bot = await this.botSvc.getBot(id);
    const groups = await this.groupSvc.listGroupsByBot(id);
    return { bot, groups };
  }

  // 新增 · 只 aiproot_admin
  @Post()
  @Roles("aiproot_admin")
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
  @Roles("aiproot_admin")
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
  @Roles("aiproot_admin")
  async disable(@Param("id") id: string) {
    await this.botSvc.disableBot(id);
    return { status: "disabled" };
  }
}
