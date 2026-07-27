import { Controller, Get, Query } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { ExtractionHealthService } from "./extraction-health.service.js";

// 抽取健康度 · 對照 docs/modules/ai-analysis-layering.md §5
// 跨租戶聚合 → 只給 aiproot 側（客戶方看不到別家的數字）
@Controller("aiproot-console/extraction-health")
export class ExtractionHealthController {
  constructor(private readonly svc: ExtractionHealthService) {}

  @Get()
  @Roles("aiproot_admin", "consultant")
  overview(@Query("days") days?: string) {
    return this.svc.overview(Number(days ?? 7));
  }
}
