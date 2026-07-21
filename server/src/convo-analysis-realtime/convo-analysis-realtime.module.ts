import { Module } from "@nestjs/common";
import { ConversationAnalysisModule } from "../conversation-analysis/conversation-analysis.module.js";
import { LineIngestModule } from "../line-ingest/line-ingest.module.js";
import { AnalysisBatchRepository } from "./analysis-batch.repository.js";
import { AnalysisBatchService } from "./analysis-batch.service.js";

@Module({
  imports: [ConversationAnalysisModule, LineIngestModule],
  providers: [AnalysisBatchRepository, AnalysisBatchService],
  exports: [AnalysisBatchRepository, AnalysisBatchService],
})
export class ConvoAnalysisRealtimeModule {}
