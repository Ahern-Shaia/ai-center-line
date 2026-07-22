import { Module } from "@nestjs/common";
import { EmployeeBindingController } from "./employee-binding.controller.js";
import { EmployeeBindingService } from "./employee-binding.service.js";
import { LiffPrefillService } from "./liff-prefill.service.js";
import { UserLineBindingRepository } from "./user-line-binding.repository.js";

@Module({
  controllers: [EmployeeBindingController],
  providers: [
    EmployeeBindingService,
    LiffPrefillService,
    UserLineBindingRepository,
  ],
  exports: [
    EmployeeBindingService,
    UserLineBindingRepository,
  ],
})
export class EmployeeBindingModule {}
