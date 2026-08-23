import { Module } from "@nestjs/common";
import { DepartmentRepository } from "./department.repository.js";
import { DepartmentService } from "./department.service.js";
import { DepartmentController } from "./department.controller.js";
import { UserRepository } from "./user.repository.js";
import { UserService } from "./user.service.js";
import { MemberGroupActivityService } from "./member-group-activity.service.js";
import { OnboardingProgressService } from "./onboarding-progress.service.js";
import { UserController } from "./user.controller.js";
import { OrgOverviewService } from "./org-overview.service.js";
import { OrgOverviewController } from "./org-overview.controller.js";

// aiproot 統包客戶方組織：departments + users CRUD + 組織關係圖 · 對應 UI 的「部門/成員」頁
@Module({
  controllers: [DepartmentController, UserController, OrgOverviewController],
  providers: [MemberGroupActivityService, OnboardingProgressService, DepartmentRepository, DepartmentService, UserRepository, UserService, OrgOverviewService],
  exports: [DepartmentService, UserService],
})
export class TenantAdminModule {}
