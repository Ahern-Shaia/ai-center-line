import { Controller, Get } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { SignoffService } from "./signoff.service.js";

@Controller("signoff")
export class SignoffController {
  constructor(private readonly svc: SignoffService) {}

  @Get()
  @Roles("tenant_admin", "group_owner", "consultant")
  async pending() {
    return { pending: await this.svc.pending() };
  }
}
