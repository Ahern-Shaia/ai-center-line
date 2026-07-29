import { Controller, Get } from "@nestjs/common";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { CostService } from "./cost.service.js";

@Controller("aiproot-console/cost")
export class CostController {
  constructor(private readonly svc: CostService) {}

  @Get("summary")
  @RequirePermission("cost-dashboard:view")
  async summary() {
    return this.svc.getSummary();
  }
}
