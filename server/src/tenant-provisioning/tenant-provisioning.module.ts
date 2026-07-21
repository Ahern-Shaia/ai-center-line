import { Module } from "@nestjs/common";
import { OnboardService } from "./onboard.service.js";
import { OnboardController } from "./onboard.controller.js";
import { PasswordPolicyService } from "../auth/password-policy.service.js";
import { PasswordHistoryRepository } from "../auth/password-history.repository.js";

@Module({
  controllers: [OnboardController],
  providers: [OnboardService, PasswordPolicyService, PasswordHistoryRepository],
  exports: [OnboardService],
})
export class TenantProvisioningModule {}
