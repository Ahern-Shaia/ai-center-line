import { Module } from "@nestjs/common";
import { DataSyncTenantRegistry } from "./tenant-config.js";
import { DataSyncRepository } from "./data-sync.repository.js";
import { DataSyncService } from "./sync.service.js";
import { DataSyncScheduler } from "./scheduler.service.js";
import { WritebackService } from "./writeback.service.js";

// Data Sync Layer · M2
// - M1: TenantRegistry + models + Connector interface + Ragic Connector
// - M2: Repository + SyncService + Scheduler(cron 15min) + WritebackService(DB polling)
// - M3+ (未實作): 影子通知 · metrics endpoint · migration SOP
// ScheduleModule.forRoot() 已於 AppModule 集中 · 此處不再重複
@Module({
  imports: [],
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
