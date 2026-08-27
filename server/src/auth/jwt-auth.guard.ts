import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import type { JwtUser } from "./jwt-user.js";
import { msg } from "../i18n/index.js";

// 第一道：驗 JWT，解出身分掛到 req.user。@Public() 路由跳過。
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: JwtUser;
    }>();
    const raw = req.headers["authorization"];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException(msg("srv.auth.noBearer"));
    }
    try {
      req.user = await this.jwt.verifyAsync<JwtUser>(header.slice(7));
    } catch {
      throw new UnauthorizedException(msg("srv.auth.badToken"));
    }
    return true;
  }
}
