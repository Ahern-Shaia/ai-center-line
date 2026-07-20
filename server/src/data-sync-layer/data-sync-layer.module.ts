import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DataSyncTenantRegistry } from "./tenant-config.js";
import { DataSyncRepository } from "./data-sync.repository.js";
import { DataSyncService } from "./sync.service.js";
import { DataSyncScheduler } from "./scheduler.service.js";
import { WritebackService } from "./writeback.service.js";

// Data Sync Layer · M2
// - M1: TenantRegistry + models + Connector interface + Ragic Connector
// - M2: Repository + SyncService + Scheduler(cron 15min) + WritebackService(DB polling)
// - M3+ (未實作): 影子通知 · metrics endpoint · migration SOP
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    DataSyncTenantRegistry,
    DataSyncRepository,
    DataSyncService,
    DataSyncScheduler,
    WritebackService,
  ],
  exports: [DataSyncTenantRegistry, DataSyncRepository, DataSyncService, WritebackService],
})
export class DataSyncLayerModule {}
