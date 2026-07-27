import { Module } from "@nestjs/common";
import { CostService } from "./cost.service.js";
import { CostController } from "./cost.controller.js";
import { AiprootTenantsController } from "./tenants.controller.js";
import { ExtractionHealthService } from "./extraction-health.service.js";
import { ExtractionHealthController } from "./extraction-health.controller.js";

@Module({
  controllers: [CostController, AiprootTenantsController, ExtractionHealthController],
  providers: [CostService, ExtractionHealthService],
  exports: [CostService],
})
export class AiprootConsoleModule {}
