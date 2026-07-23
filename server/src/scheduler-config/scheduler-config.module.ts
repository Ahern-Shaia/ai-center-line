import { Module, OnModuleInit } from "@nestjs/common";
import { ConvoAnalysisRealtimeModule } from "../convo-analysis-realtime/convo-analysis-realtime.module.js";
import { PermissionModule } from "../permission/permission.module.js";
import { PersonalDailyReportModule } from "../personal-daily-report/personal-daily-report.module.js";
import { SchedulerConfigController } from "./scheduler-config.controller.js";
import { SchedulerConfigRepository } from "./scheduler-config.repository.js";
import { SchedulerConfigService } from "./scheduler-config.service.js";
import { SchedulerManager } from "./scheduler-manager.service.js";
import { WarroomBatchController } from "./warroom-batch.controller.js";

/**
 * SchedulerConfigModule · 平台化定時任務
 * 對照 docs/modules/scheduler-config.md
 * · 依 PersonalDailyReportModule (PDR scheduler) + ConvoAnalysisRealtimeModule (batch scheduler) 兩個 executor
 * · PermissionModule 用於 @RequirePermission decorator (實際 guard 在 AppModule 全域註冊)
 * · ScheduleModule.forRoot() 已於 AppModule 集中 register · 此處不重複
 */
@Module({
  imports: [
    PermissionModule,
    PersonalDailyReportModule,
    ConvoAnalysisRealtimeModule,
  ],
  controllers: [SchedulerConfigController, WarroomBatchController],
  providers: [
    SchedulerConfigRepository,
    SchedulerConfigService,
    SchedulerManager,
  ],
  exports: [SchedulerConfigService, SchedulerManager],
})
export class SchedulerConfigModule implements OnModuleInit {
  constructor(
    private readonly svc: SchedulerConfigService,
    private readonly manager: SchedulerManager,
  ) {}

  onModuleInit(): void {
    // Circular ref 避開 · Manager 需要透過 svc 觸發 reload · svc 需要 manager instance
    this.svc.setManager(this.manager);
  }
}
