import { Module } from "@nestjs/common";
import { RagicApiClient } from "./ragic-api.client.js";
import { RagicAccountRepository } from "./ragic-account.repository.js";
import { RagicAccountService } from "./ragic-account.service.js";

/**
 * Ragic 存取的共用模組 · docs/modules/master-data-sync.md §6
 *
 * 2026-07-28 從 notify-config/ 搬出來。當初只有通知在用所以放那裡，
 * 但主檔同步是第二個使用者，若之後加「LINE 指令寫回 Ragic」就是第三個。
 * 純搬移，行為不變 —— 現在搬很便宜，第三個使用者出現時再搬要改三處。
 */
@Module({
  providers: [RagicApiClient, RagicAccountRepository, RagicAccountService],
  exports: [RagicApiClient, RagicAccountRepository, RagicAccountService],
})
export class RagicModule {}
