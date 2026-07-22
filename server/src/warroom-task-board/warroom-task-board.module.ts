import { Module } from "@nestjs/common";
import { CategoryRegistryController } from "./category-registry.controller.js";
import { CategoryRegistryRepository } from "./category-registry.repository.js";
import { TicketMaterializerService } from "./ticket-materializer.service.js";

/**
 * Warroom Task Board 模組 · WTB
 * 對照 docs/modules/warroom-task-board.md
 * · Materializer service · records → tickets
 * · Category registry repository · pipeline 用 + aiproot 分類管理 UI 用
 * · CategoryRegistryController · aiproot 分類管理頁
 * · warroom.service (在 app.module) 消費 tickets · role-scoped filter
 */
@Module({
  controllers: [CategoryRegistryController],
  providers: [
    TicketMaterializerService,
    CategoryRegistryRepository,
  ],
  exports: [
    TicketMaterializerService,
    CategoryRegistryRepository,
  ],
})
export class WarroomTaskBoardModule {}
