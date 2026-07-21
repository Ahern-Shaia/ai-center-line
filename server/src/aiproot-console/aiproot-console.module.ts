import { Module } from "@nestjs/common";
import { CostService } from "./cost.service.js";
import { CostController } from "./cost.controller.js";

@Module({
  controllers: [CostController],
  providers: [CostService],
  exports: [CostService],
})
export class AiprootConsoleModule {}
