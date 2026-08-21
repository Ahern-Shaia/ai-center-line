import { Global, Module } from "@nestjs/common";
import { PermissionService } from "./permission.service.js";
import { PermissionController } from "./permission.controller.js";
import { TenantRolesService } from "./tenant-roles.service.js";
import { TenantRolesController } from "./tenant-roles.controller.js";

// Global · PermissionGuard 掛到 app 層 · Service 需全 module 可注
@Global()
@Module({
  controllers: [PermissionController, TenantRolesController],
  providers: [PermissionService, TenantRolesService],
  exports: [PermissionService],
})
export class PermissionModule {}
