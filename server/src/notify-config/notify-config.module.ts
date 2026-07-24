import { Module } from "@nestjs/common";
import { NotificationHubModule } from "../notification-hub/notification-hub.module.js";
import { RagicApiClient } from "./ragic-api.client.js";
import { RagicAccountRepository } from "./ragic-account.repository.js";
import { RagicAccountService } from "./ragic-account.service.js";
import { NotifyConfigRepository } from "./notify-config.repository.js";
import { NotifyConfigService } from "./notify-config.service.js";
import { NotifyConfigController } from "./notify-config.controller.js";

// aiproot「通知設定」UI 的 API（Ragic 帳號管理 + 抓欄位 + 規則 CRUD）
// v3 起規則本體存 notification_rule（見 notification-hub）；本模組只負責設定面。
@Module({
  imports: [NotificationHubModule],   // RuleRepository（規則本體）
  controllers: [NotifyConfigController],
  providers: [
    RagicApiClient,
    RagicAccountRepository,
    RagicAccountService,
    NotifyConfigRepository,
    NotifyConfigService,
  ],
  exports: [RagicApiClient, RagicAccountService, NotifyConfigService],
})
export class NotifyConfigModule {}
