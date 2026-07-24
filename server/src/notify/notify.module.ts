import { Module } from "@nestjs/common";
import { NotifyController } from "./notify.controller.js";
import { NotifyService } from "./notify.service.js";
import { NotifyRepository } from "./notify.repository.js";
import { LineClient } from "./line.client.js";
import { TenantRegistry } from "./tenant.registry.js";

@Module({
  controllers: [NotifyController],
  providers: [NotifyService, NotifyRepository, LineClient, TenantRegistry],
  exports: [LineClient, NotifyRepository],   // 供 notify v2（notify-config webhook）復用 push + audit
})
export class NotifyModule {}
