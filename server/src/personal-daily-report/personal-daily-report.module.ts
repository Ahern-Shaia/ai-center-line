import { Module } from "@nestjs/common";
import { EmployeeBindingModule } from "../employee-binding/employee-binding.module.js";
import { LineIngestModule } from "../line-ingest/line-ingest.module.js";
import { LlmModule } from "../llm/llm.module.js";
import { PersonalDailyReportController } from "./personal-daily-report.controller.js";
import { PersonalDailyReportRepository } from "./personal-daily-report.repository.js";
import { PersonalDailyReportService } from "./personal-daily-report.service.js";
import { PersonalReportNotifyService } from "./personal-report-notify.service.js";
import { PersonalReportSchedulerService } from "./personal-report-scheduler.service.js";

/**
 * Personal Daily Report Module · PDR
 * 對照 docs/modules/personal-daily-report.md
 * · 依賴 employee-line-binding 方向 8 · webhook 已於 ELB 處理 chat_context='personal'
 * · 依賴 LineIngestModule (LineApiClient · notify push 用)
 */
@Module({
  imports: [LlmModule, LineIngestModule, EmployeeBindingModule],   // ScheduleModule.forRoot() 已於 AppModule 集中 · EmployeeBindingModule 用於 LIFF 端點認證
  controllers: [PersonalDailyReportController],
  providers: [
    PersonalDailyReportRepository,
    PersonalDailyReportService,
    PersonalReportSchedulerService,
    PersonalReportNotifyService,
  ],
  exports: [
    PersonalDailyReportService,
    PersonalDailyReportRepository,
  ],
})
export class PersonalDailyReportModule {}
