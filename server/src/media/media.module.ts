import { Module } from "@nestjs/common";
import { LineIngestModule } from "../line-ingest/line-ingest.module.js";
import { MediaController } from "./media.controller.js";
import { MediaService } from "./media.service.js";

@Module({
  imports: [LineIngestModule],
  controllers: [MediaController],
  providers: [MediaService],
})
export class MediaModule {}
