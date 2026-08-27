import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { JwtUser } from "../auth/jwt-user.js";
import { REQUIRE_PERMISSION_KEY } from "./require-permission.decorator.js";
import { PermissionService } from "./permission.service.js";
import { msg } from "../i18n/index.js";

// 全域三層之外的 permission gate · @RequirePermission 有標才觸發
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permSvc: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    const user = req.user;
    if (!user) throw new ForbiddenException(msg("srv.auth.notSignedIn"));

    const userPerms = await this.permSvc.getUserPermissions(user.user_id);
    // 滿足任一即可
    for (const p of required) if (userPerms.has(p)) return true;
    throw new ForbiddenException(msg("srv.auth.forbidden"));
  }
}
