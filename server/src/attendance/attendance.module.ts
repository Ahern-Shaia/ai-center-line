import { Module } from "@nestjs/common";
import { AttendanceController } from "./attendance.controller.js";
import { AttendanceService } from "./attendance.service.js";
import { AttendanceRepository } from "./attendance.repository.js";

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceRepository],
})
export class AttendanceModule {}
