import { Module } from "@nestjs/common";
import { PermissionModule } from "../permission/permission.module.js";
import { TaskConfigController } from "./task-config.controller.js";
import { TaskConfigService } from "./task-config.service.js";

@Module({
  imports: [PermissionModule],
  controllers: [TaskConfigController],
  providers: [TaskConfigService],
  exports: [TaskConfigService],
})
export class TaskConfigModule {}
