import { Module } from "@nestjs/common";
import { NotificationHubModule } from "../notification-hub/notification-hub.module.js";
import { AttendanceController } from "./attendance.controller.js";
import { MapConfigController } from "./map-config.controller.js";
import { AttendanceService } from "./attendance.service.js";
import { AttendanceRepository } from "./attendance.repository.js";
import { MapRoutingConfigRepository } from "./map-routing-config.repository.js";

@Module({
  imports: [NotificationHubModule],   // NotificationBus（發 attendance.suspicious 事件）
  controllers: [AttendanceController, MapConfigController],
  providers: [AttendanceService, AttendanceRepository, MapRoutingConfigRepository],
})
export class AttendanceModule {}
