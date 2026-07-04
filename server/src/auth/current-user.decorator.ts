import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { JwtUser } from "./jwt-user.js";

// 取當前登入者（由 JwtAuthGuard 掛在 req.user）。
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): JwtUser => {
  return ctx.switchToHttp().getRequest<{ user: JwtUser }>().user;
});
