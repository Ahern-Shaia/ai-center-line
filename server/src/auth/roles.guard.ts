import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "./roles.decorator.js";
import type { Role } from "../db/schema.js";
import type { JwtUser } from "./jwt-user.js";

// 第二道：檢查 req.user.role 是否在 @Roles(...) 允許清單。無 @Roles 的路由不限角色（但仍需登入）。
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const req = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ForbiddenException("角色無權限");
    }
    return true;
  }
}
