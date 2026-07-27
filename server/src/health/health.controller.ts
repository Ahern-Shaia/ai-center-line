import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";
import { HealthService, type HealthResult } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  async get(): Promise<{ status: string } & HealthResult> {
    return { status: "ok", ...(await this.health.check()) };
  }
}
