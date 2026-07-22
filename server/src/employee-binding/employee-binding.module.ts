import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { EmployeeBindingController } from "./employee-binding.controller.js";
import { EmployeeBindingService } from "./employee-binding.service.js";
import { LiffPrefillService } from "./liff-prefill.service.js";
import { NudgeService } from "./nudge.service.js";
import { UserLineBindingRepository } from "./user-line-binding.repository.js";

// NudgeService 直接跑 raw SQL · 不依賴 LineMessageRepository → 避免 LineIngestModule ↔ EmployeeBindingModule 環回
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [EmployeeBindingController],
  providers: [
    EmployeeBindingService,
    LiffPrefillService,
    UserLineBindingRepository,
    NudgeService,
  ],
  exports: [
    EmployeeBindingService,
    UserLineBindingRepository,
  ],
})
export class EmployeeBindingModule {}
