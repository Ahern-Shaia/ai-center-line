import { Controller, Get } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { WarroomService } from "./warroom.service.js";

@Controller("warroom")
export class WarroomController {
  constructor(private readonly svc: WarroomService) {}

  // 三環指標（÷N）＋各群組狀態。RLS 自動限本租戶（group_owner 再限本部門）。
  @Get()
  @Roles("tenant_admin", "group_owner", "consultant")
  async warroom() {
    return this.svc.warroom();
  }
}
