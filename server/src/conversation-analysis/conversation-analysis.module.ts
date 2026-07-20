import { Module } from "@nestjs/common";
import { ConversationAnalysisController } from "./conversation-analysis.controller.js";
import { AnalyzeService } from "./analyze.service.js";
import { LabelService } from "./label.service.js";

@Module({
  controllers: [ConversationAnalysisController],
  providers: [AnalyzeService, LabelService],
})
export class ConversationAnalysisModule {}
