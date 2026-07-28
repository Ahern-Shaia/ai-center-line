import { Module } from "@nestjs/common";
import { EmployeeBindingModule } from "../employee-binding/employee-binding.module.js";
import { LineApiClient } from "./line-api.client.js";
import { LineBotRepository } from "./line-bot.repository.js";
import { LineGroupRepository } from "./line-group.repository.js";
import { LineMessageRepository } from "./line-message.repository.js";
import { LineMediaRepository } from "./line-media.repository.js";
import { LineMemberRepository } from "./line-member.repository.js";
import { LineBotService } from "./line-bot.service.js";
import { LineGroupService } from "./line-group.service.js";
import { LineWebhookService } from "./line-webhook.service.js";
import { MediaStorageService } from "./media-storage.service.js";
import { MediaDownloadService } from "./media-download.service.js";
import { MemberFetchService } from "./member-fetch.service.js";
import { CompletionSignalService } from "../task-completion/completion-signal.service.js";
import { LineBotController } from "./line-bot.controller.js";
import { LineGroupController } from "./line-group.controller.js";
import { LineWebhookController } from "./line-webhook.controller.js";

@Module({
  imports: [EmployeeBindingModule],       // 0016 · webhook 用 EmployeeBindingService · NudgeService 用 raw SQL 不再環回
  controllers: [LineBotController, LineGroupController, LineWebhookController],
  providers: [
    LineApiClient,
    LineBotRepository,
    LineGroupRepository,
    LineMessageRepository,
    LineMediaRepository,
    LineMemberRepository,
    LineBotService,
    LineGroupService,
    LineWebhookService,
    MediaStorageService,
    MediaDownloadService,
    MemberFetchService,
    CompletionSignalService,
  ],
  exports: [
    LineBotService,
    LineGroupService,
    LineApiClient,                  // PDR-M5 · personal-report notify service 用 pushMessage
    LineMessageRepository,          // convo-analysis-realtime M2 batch service 讀
    LineGroupRepository,            // scheduler-config M4 · WarroomBatchController backfill display_name 用
    MediaStorageService,            // 若 aiproot console 要放 signed URL 也走這
  ],
})
export class LineIngestModule {}
