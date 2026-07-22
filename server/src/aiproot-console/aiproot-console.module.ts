import { Module } from "@nestjs/common";
import { CostService } from "./cost.service.js";
import { CostController } from "./cost.controller.js";
import { AiprootTenantsController } from "./tenants.controller.js";

@Module({
  controllers: [CostController, AiprootTenantsController],
  providers: [CostService],
  exports: [CostService],
})
export class AiprootConsoleModule {}
