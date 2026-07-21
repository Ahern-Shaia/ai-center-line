import { Module } from "@nestjs/common";
import { ConversationAnalysisController } from "./conversation-analysis.controller.js";
import { AnalyzeService } from "./analyze.service.js";
import { LabelService } from "./label.service.js";
import { LlmModule } from "../llm/llm.module.js";

@Module({
  imports: [LlmModule],
  controllers: [ConversationAnalysisController],
  providers: [AnalyzeService, LabelService],
  exports: [AnalyzeService],   // convo-analysis-realtime AnalysisBatchService 需 createBatchUpload
})
export class ConversationAnalysisModule {}
