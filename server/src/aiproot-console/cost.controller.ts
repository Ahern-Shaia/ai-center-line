import { Controller, Get } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { CostService } from "./cost.service.js";

@Controller("aiproot-console/cost")
export class CostController {
  constructor(private readonly svc: CostService) {}

  @Get("summary")
  @Roles("aiproot_admin", "consultant")
  async summary() {
    return this.svc.getSummary();
  }
}
