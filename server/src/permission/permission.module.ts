import { Global, Module } from "@nestjs/common";
import { PermissionService } from "./permission.service.js";
import { PermissionController } from "./permission.controller.js";

// Global · PermissionGuard 掛到 app 層 · Service 需全 module 可注
@Global()
@Module({
  controllers: [PermissionController],
  providers: [PermissionService],
  exports: [PermissionService],
})
export class PermissionModule {}
