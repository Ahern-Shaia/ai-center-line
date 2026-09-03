import { Module } from "@nestjs/common";
import { CompletionSignalService } from "./completion-signal.service.js";
import { PrivateCompletionService } from "./private-completion.service.js";
import { TaskConfigModule } from "../task-config/task-config.module.js";
import { SignalResolverService } from "./signal-resolver.service.js";
import { WorkStatusService } from "./work-status.service.js";
// ⚠️ 直接掛 LineApiClient 而不是 import LineIngestModule ——
//    LineIngestModule 已經 import 本模組（webhook 用 PrivateCompletionService），反向 import 會變循環。
//    LineApiClient 無建構子依賴、無狀態（純 HTTP client），多一個實例沒有代價。
import { LineApiClient } from "../line-ingest/line-api.client.js";
import { CompletionSignalController } from "./completion-signal.controller.js";

/**
 * 任務追蹤到結束 · docs/modules/task-completion-tracking.md
 *
 * 三段：
 *   CompletionSignalService  · 即時收（M3a）· 由 line-ingest 呼叫
 *   SignalResolverService    · 批次後對應（M3b）· 由 conversation-analysis 呼叫
 */
@Module({
  imports: [TaskConfigModule],
  controllers: [CompletionSignalController],
  providers: [CompletionSignalService, PrivateCompletionService, SignalResolverService, WorkStatusService, LineApiClient],
  exports: [CompletionSignalService, PrivateCompletionService, SignalResolverService, WorkStatusService],
})
export class TaskCompletionModule {}
