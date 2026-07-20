import { Module } from "@nestjs/common";
import { LlmConfigController } from "./llm-config.controller.js";
import { LlmConfigService } from "./llm-config.service.js";
import { LlmConfigRepository } from "./llm-config.repository.js";

@Module({
  controllers: [LlmConfigController],
  providers: [LlmConfigService, LlmConfigRepository],
  exports: [LlmConfigService],
})
export class LlmModule {}
