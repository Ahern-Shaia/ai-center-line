import { BadRequestException, Body, Controller, Param, Post } from "@nestjs/common";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { OnboardService } from "./onboard.service.js";
import { OnboardTenantSchema, ResetPasswordSchema, UnlockSchema } from "./dto/onboard.dto.js";

@Controller("tenant-provisioning")
export class OnboardController {
  constructor(private readonly svc: OnboardService) {}

  @Post("onboard")
  @RequirePermission("tenants:onboard")
  async onboard(@Body() body: unknown) {
    const parsed = OnboardTenantSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return this.svc.onboardTenant(parsed.data);
  }

  @Post("users/:userId/reset-password")
  @RequirePermission("users:reset-password")
  async resetPassword(@Param("userId") userId: string, @Body() body: unknown) {
    const parsed = ResetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return this.svc.resetUserPassword(userId, parsed.data.tenantId);
  }

  @Post("users/:userId/unlock")
  @RequirePermission("users:unlock")
  async unlock(@Param("userId") userId: string, @Body() body: unknown) {
    const parsed = UnlockSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return this.svc.unlockUser(userId, parsed.data.tenantId);
  }
}
