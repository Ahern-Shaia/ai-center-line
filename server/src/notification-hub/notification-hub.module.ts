import { Module } from "@nestjs/common";
import { RagicModule } from "../ragic/ragic.module.js";
import { RuleRepository } from "./rule.repository.js";
import { HubAuditRepository } from "./audit.repository.js";
import { LineSender } from "./channels/line.sender.js";
import { NotificationPipeline } from "./notification.pipeline.js";
import { NotificationBus } from "./notification.bus.js";
import { RagicWebhookService } from "./sources/ragic-webhook.service.js";
import { RagicWebhookController } from "./sources/ragic-webhook.controller.js";

// 通知中心（notify v3）· 來源/管道可插拔
// 對照 docs/modules/notification-hub.md
// 其他模組要發通知：注入 NotificationBus 後 emit 領域事件即可（不需知道任何管道細節）
@Module({
  imports: [RagicModule],
  controllers: [RagicWebhookController],
  providers: [
    RuleRepository,
    HubAuditRepository,
    LineSender,
    NotificationPipeline,
    NotificationBus,
    RagicWebhookService,
  ],
  exports: [NotificationBus, NotificationPipeline, RuleRepository, HubAuditRepository],
})
export class NotificationHubModule {}
