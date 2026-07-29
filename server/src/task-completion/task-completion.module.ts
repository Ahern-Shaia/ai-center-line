import { Module } from "@nestjs/common";
import { CompletionSignalService } from "./completion-signal.service.js";
import { OpenTaskReminderService } from "./open-task-reminder.service.js";
import { TaskConfigModule } from "../task-config/task-config.module.js";
import { SignalResolverService } from "./signal-resolver.service.js";
import { WorkStatusService } from "./work-status.service.js";
import { CompletionSignalController } from "./completion-signal.controller.js";

/**
 * 任務追蹤到結束 · docs/modules/task-completion-tracking.md
 *
 * 三段：
 *   CompletionSignalService  · 即時收（M3a）· 由 line-ingest 呼叫
 *   SignalResolverService    · 批次後對應（M3b）· 由 conversation-analysis 呼叫
 *   OpenTaskReminderService  · 每日回報附清單（M3.5）· 由 line-ingest 呼叫
 */
@Module({
  imports: [TaskConfigModule],
  controllers: [CompletionSignalController],
  providers: [CompletionSignalService, OpenTaskReminderService, SignalResolverService, WorkStatusService],
  exports: [CompletionSignalService, OpenTaskReminderService, SignalResolverService, WorkStatusService],
})
export class TaskCompletionModule {}
