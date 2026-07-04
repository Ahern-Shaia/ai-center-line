import { Body, Controller, Get, Post } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { SignoffService } from "./signoff.service.js";

@Controller("signoff")
export class SignoffController {
  constructor(private readonly svc: SignoffService) {}

  @Get()
  @Roles("tenant_admin", "group_owner", "consultant")
  async pending() {
    return { pending: await this.svc.pending() };
  }

  // 確認今日進度。tenant_admin 可簽本租戶各部門；group_owner 限本部門（RLS）。
  @Post()
  @Roles("tenant_admin", "group_owner", "consultant")
  async confirm(@CurrentUser() user: JwtUser, @Body() body: { ticket_ids?: string[] }) {
    return this.svc.confirm(user.user_id, body?.ticket_ids ?? []);
  }
}
