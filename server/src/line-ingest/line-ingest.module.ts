import { Module } from "@nestjs/common";
import { LineApiClient } from "./line-api.client.js";
import { LineBotRepository } from "./line-bot.repository.js";
import { LineGroupRepository } from "./line-group.repository.js";
import { LineBotService } from "./line-bot.service.js";
import { LineGroupService } from "./line-group.service.js";
import { LineWebhookService } from "./line-webhook.service.js";
import { LineBotController } from "./line-bot.controller.js";
import { LineGroupController } from "./line-group.controller.js";
import { LineWebhookController } from "./line-webhook.controller.js";

@Module({
  controllers: [LineBotController, LineGroupController, LineWebhookController],
  providers: [
    LineApiClient,
    LineBotRepository,
    LineGroupRepository,
    LineBotService,
    LineGroupService,
    LineWebhookService,
  ],
  exports: [LineBotService, LineGroupService],
})
export class LineIngestModule {}
