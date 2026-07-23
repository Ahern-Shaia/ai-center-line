import { Module } from "@nestjs/common";
import { ConversationAnalysisModule } from "../conversation-analysis/conversation-analysis.module.js";
import { LineIngestModule } from "../line-ingest/line-ingest.module.js";
import { AnalysisBatchRepository } from "./analysis-batch.repository.js";
import { AnalysisBatchService } from "./analysis-batch.service.js";
import { BatchSchedulerService } from "./batch-scheduler.service.js";
import { AnalysisBatchController } from "./analysis-batch.controller.js";

// ScheduleModule.forRoot() 已於 AppModule 集中 register · 此處不再重複 (會複製 cron 觸發)
@Module({
  imports: [
    ConversationAnalysisModule,
    LineIngestModule,
  ],
  controllers: [AnalysisBatchController],
  providers: [AnalysisBatchRepository, AnalysisBatchService, BatchSchedulerService],
  exports: [AnalysisBatchRepository, AnalysisBatchService, BatchSchedulerService],
})
export class ConvoAnalysisRealtimeModule {}
