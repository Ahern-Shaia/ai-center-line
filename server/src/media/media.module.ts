import { Module } from "@nestjs/common";
import { LineIngestModule } from "../line-ingest/line-ingest.module.js";
import { MediaController } from "./media.controller.js";
import { MediaPurgeService } from "./media-purge.service.js";
import { MediaService } from "./media.service.js";

@Module({
  imports: [LineIngestModule],
  controllers: [MediaController],
  providers: [MediaService, MediaPurgeService],
})
export class MediaModule {}
