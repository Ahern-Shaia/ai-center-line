import { Module } from "@nestjs/common";
import { NotificationHubModule } from "../notification-hub/notification-hub.module.js";
import { RagicModule } from "../ragic/ragic.module.js";
import { NotifyConfigRepository } from "./notify-config.repository.js";
import { NotifyConfigService } from "./notify-config.service.js";
import { NotifyConfigController } from "./notify-config.controller.js";

// aiproot「通知設定」UI 的 API（Ragic 帳號管理 + 抓欄位 + 規則 CRUD）
// v3 起規則本體存 notification_rule（見 notification-hub）；本模組只負責設定面。
// Ragic 存取本身已抽到 RagicModule（主檔同步是第二個使用者）。
@Module({
  imports: [NotificationHubModule, RagicModule],
  controllers: [NotifyConfigController],
  providers: [NotifyConfigRepository, NotifyConfigService],
  exports: [RagicModule, NotifyConfigService],
})
export class NotifyConfigModule {}
