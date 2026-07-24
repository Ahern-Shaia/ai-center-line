import { Module } from "@nestjs/common";
import { AttendanceController } from "./attendance.controller.js";
import { MapConfigController } from "./map-config.controller.js";
import { AttendanceService } from "./attendance.service.js";
import { AttendanceRepository } from "./attendance.repository.js";
import { MapRoutingConfigRepository } from "./map-routing-config.repository.js";

@Module({
  controllers: [AttendanceController, MapConfigController],
  providers: [AttendanceService, AttendanceRepository, MapRoutingConfigRepository],
})
export class AttendanceModule {}
