import { Module } from "@nestjs/common";
import { RagicApiClient } from "./ragic-api.client.js";
import { RagicAccountRepository } from "./ragic-account.repository.js";
import { RagicAccountService } from "./ragic-account.service.js";
import { NotifyConfigRepository } from "./notify-config.repository.js";
import { NotifyConfigService } from "./notify-config.service.js";

// notify v2 自助設定平台（config-driven）· M1 地基（controller 於 M3）
// 對照 docs/modules/notify-selfserve-platform.md
@Module({
  providers: [
    RagicApiClient,
    RagicAccountRepository,
    RagicAccountService,
    NotifyConfigRepository,
    NotifyConfigService,
  ],
  exports: [RagicApiClient, RagicAccountService, NotifyConfigRepository, NotifyConfigService],
})
export class NotifyConfigModule {}
