import { Module } from "@nestjs/common";
import { NotifyController } from "./notify.controller.js";
import { NotifyService } from "./notify.service.js";
import { NotifyRepository } from "./notify.repository.js";
import { LineClient } from "./line.client.js";

@Module({
  controllers: [NotifyController],
  providers: [NotifyService, NotifyRepository, LineClient],
})
export class NotifyModule {}
