import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ScheduleModule } from "@nestjs/schedule";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { LineOauthService } from "./auth/line-oauth.service.js";
import { PasswordPolicyService } from "./auth/password-policy.service.js";
import { PasswordHistoryRepository } from "./auth/password-history.repository.js";
import { JwtAuthGuard } from "./auth/jwt-auth.guard.js";
import { RolesGuard } from "./auth/roles.guard.js";
import { TenantTxInterceptor } from "./tenant/tenant.interceptor.js";
import { SignoffController } from "./signoff/signoff.controller.js";
import { SignoffService } from "./signoff/signoff.service.js";
import { WarroomController } from "./warroom/warroom.controller.js";
import { WarroomService } from "./warroom/warroom.service.js";
import { WarroomTasksService } from "./warroom/warroom-tasks.service.js";
import { ArchivedTasksService } from "./warroom/archived-tasks.service.js";
import { AssignNotifyService } from "./warroom/assign-notify.service.js";
import { WorkStatusService } from "./task-completion/work-status.service.js";
import { NotifyModule } from "./notify/notify.module.js";
import { ConversationAnalysisModule } from "./conversation-analysis/conversation-analysis.module.js";
import { DataSyncLayerModule } from "./data-sync-layer/data-sync-layer.module.js";
import { LlmModule } from "./llm/llm.module.js";
import { LineIngestModule } from "./line-ingest/line-ingest.module.js";
import { TenantAdminModule } from "./tenant-admin/tenant-admin.module.js";
import { TenantProvisioningModule } from "./tenant-provisioning/tenant-provisioning.module.js";
import { PermissionModule } from "./permission/permission.module.js";
import { AiprootConsoleModule } from "./aiproot-console/aiproot-console.module.js";
import { PermissionGuard } from "./permission/permission.guard.js";
import { ConvoAnalysisRealtimeModule } from "./convo-analysis-realtime/convo-analysis-realtime.module.js";
import { EmployeeBindingModule } from "./employee-binding/employee-binding.module.js";
import { WarroomTaskBoardModule } from "./warroom-task-board/warroom-task-board.module.js";
import { PersonalDailyReportModule } from "./personal-daily-report/personal-daily-report.module.js";
import { SchedulerConfigModule } from "./scheduler-config/scheduler-config.module.js";
import { TaskConfigModule } from "./task-config/task-config.module.js";
import { AttendanceModule } from "./attendance/attendance.module.js";
import { NotifyConfigModule } from "./notify-config/notify-config.module.js";
import { NotificationHubModule } from "./notification-hub/notification-hub.module.js";
import { MediaModule } from "./media/media.module.js";
import { MasterDataModule } from "./master-data/master-data.module.js";
import { AuditModule } from "./audit/audit.module.js";

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? "dev-only-change-me",
      signOptions: { expiresIn: "8h" },
    }),
    ScheduleModule.forRoot(),   // Global · 集中一次 register · feature module 不再重複 (每次 forRoot 會複製 cron 註冊)
    NotifyModule,
    LlmModule,
    ConversationAnalysisModule,
    DataSyncLayerModule,
    LineIngestModule,
    TenantAdminModule,
    TenantProvisioningModule,
    PermissionModule,
    AiprootConsoleModule,
    ConvoAnalysisRealtimeModule,
    EmployeeBindingModule,
    WarroomTaskBoardModule,
    PersonalDailyReportModule,
    SchedulerConfigModule,
    TaskConfigModule,
    AttendanceModule,
    NotificationHubModule,
    NotifyConfigModule,
    MediaModule,
    AuditModule,
    MasterDataModule,
  ],
  controllers: [HealthController, AuthController, SignoffController, WarroomController],
  providers: [
    HealthService,
    AuthService,
    LineOauthService,
    PasswordPolicyService,
    PasswordHistoryRepository,
    SignoffService,
    WarroomService,
    WarroomTasksService,
    ArchivedTasksService,
    AssignNotifyService,
    WorkStatusService,
    // 全域四層：JWT → RolesGuard (backward compat) → PermissionGuard (@RequirePermission) → 包 tenant tx
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantTxInterceptor },
  ],
})
export class AppModule {}
