import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { JwtAuthGuard } from "./auth/jwt-auth.guard.js";
import { RolesGuard } from "./auth/roles.guard.js";
import { TenantTxInterceptor } from "./tenant/tenant.interceptor.js";
import { SignoffController } from "./signoff/signoff.controller.js";
import { SignoffService } from "./signoff/signoff.service.js";
import { WarroomController } from "./warroom/warroom.controller.js";
import { WarroomService } from "./warroom/warroom.service.js";

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? "dev-only-change-me",
      signOptions: { expiresIn: "8h" },
    }),
  ],
  controllers: [HealthController, AuthController, SignoffController, WarroomController],
  providers: [
    HealthService,
    AuthService,
    SignoffService,
    WarroomService,
    // 全域三層：先驗 JWT（設 req.user）→ 再檢查角色 → interceptor 包租戶交易＋audit
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantTxInterceptor },
  ],
})
export class AppModule {}
