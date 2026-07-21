import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { ConversationAnalysisModule } from "../conversation-analysis/conversation-analysis.module.js";
import { LineIngestModule } from "../line-ingest/line-ingest.module.js";
import { AnalysisBatchRepository } from "./analysis-batch.repository.js";
import { AnalysisBatchService } from "./analysis-batch.service.js";
import { BatchSchedulerService } from "./batch-scheduler.service.js";
import { AnalysisBatchController } from "./analysis-batch.controller.js";

@Module({
  imports: [
    ScheduleModule.forRoot(),          // data-sync-layer 已引 · nest 允多次 forRoot () · 冪等
    ConversationAnalysisModule,
    LineIngestModule,
  ],
  controllers: [AnalysisBatchController],
  providers: [AnalysisBatchRepository, AnalysisBatchService, BatchSchedulerService],
  exports: [AnalysisBatchRepository, AnalysisBatchService, BatchSchedulerService],
})
export class ConvoAnalysisRealtimeModule {}
