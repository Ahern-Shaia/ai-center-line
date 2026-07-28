import { Module } from "@nestjs/common";
import { RagicModule } from "../ragic/ragic.module.js";
import { MasterDataController } from "./master-data.controller.js";
import { MasterDataRepository } from "./master-data.repository.js";
import { MasterDataSyncService } from "./master-data-sync.service.js";
import { MasterDataSyncCron } from "./master-data-sync.cron.js";

@Module({
  imports: [RagicModule],
  controllers: [MasterDataController],
  providers: [MasterDataRepository, MasterDataSyncService, MasterDataSyncCron],
  exports: [MasterDataRepository],
})
export class MasterDataModule {}
