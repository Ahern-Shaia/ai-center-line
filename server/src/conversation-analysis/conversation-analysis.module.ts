import { Module } from "@nestjs/common";
import { TaskCompletionModule } from "../task-completion/task-completion.module.js";
import { ConversationAnalysisController } from "./conversation-analysis.controller.js";
import { AnalyzeService } from "./analyze.service.js";
import { LabelService } from "./label.service.js";
import { LlmModule } from "../llm/llm.module.js";
import { WarroomTaskBoardModule } from "../warroom-task-board/warroom-task-board.module.js";

@Module({
  imports: [LlmModule, WarroomTaskBoardModule, TaskCompletionModule],   // WTB-M1 · materialize records → tickets
  controllers: [ConversationAnalysisController],
  providers: [AnalyzeService, LabelService],
  exports: [AnalyzeService],   // convo-analysis-realtime AnalysisBatchService 需 createBatchUpload
})
export class ConversationAnalysisModule {}
