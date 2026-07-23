import { Module } from "@nestjs/common";
import { EmployeeBindingController } from "./employee-binding.controller.js";
import { EmployeeBindingService } from "./employee-binding.service.js";
import { LiffPrefillService } from "./liff-prefill.service.js";
import { NudgeService } from "./nudge.service.js";
import { UserLineBindingRepository } from "./user-line-binding.repository.js";

// NudgeService 直接跑 raw SQL · 不依賴 LineMessageRepository → 避免 LineIngestModule ↔ EmployeeBindingModule 環回
// ScheduleModule.forRoot() 已於 AppModule 集中 · 此處不再重複 (@Cron 全域生效)
@Module({
  imports: [],
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
