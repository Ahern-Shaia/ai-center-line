import { Module } from "@nestjs/common";
import { DepartmentRepository } from "./department.repository.js";
import { DepartmentService } from "./department.service.js";
import { DepartmentController } from "./department.controller.js";
import { UserRepository } from "./user.repository.js";
import { UserService } from "./user.service.js";
import { UserController } from "./user.controller.js";

// aiproot 統包客戶方組織：departments + users CRUD · 對應 UI 的「部門/成員」頁
@Module({
  controllers: [DepartmentController, UserController],
  providers: [DepartmentRepository, DepartmentService, UserRepository, UserService],
  exports: [DepartmentService, UserService],
})
export class TenantAdminModule {}
