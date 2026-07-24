import { Module } from "@nestjs/common";
import { NotifyModule } from "../notify/notify.module.js";
import { RagicApiClient } from "./ragic-api.client.js";
import { RagicAccountRepository } from "./ragic-account.repository.js";
import { RagicAccountService } from "./ragic-account.service.js";
import { NotifyConfigRepository } from "./notify-config.repository.js";
import { NotifyConfigService } from "./notify-config.service.js";
import { WebhookController } from "./webhook.controller.js";
import { WebhookService } from "./webhook.service.js";

// notify v2 自助設定平台（config-driven）· M1 地基 + M2 webhook 接收（設定 UI 於 M3）
// 對照 docs/modules/notify-selfserve-platform.md
@Module({
  imports: [NotifyModule],   // 復用 LineClient（push）+ NotifyRepository（audit）
  controllers: [WebhookController],
  providers: [
    RagicApiClient,
    RagicAccountRepository,
    RagicAccountService,
    NotifyConfigRepository,
    NotifyConfigService,
    WebhookService,
  ],
  exports: [RagicApiClient, RagicAccountService, NotifyConfigRepository, NotifyConfigService],
})
export class NotifyConfigModule {}
