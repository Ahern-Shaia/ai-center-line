import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "./roles.decorator.js";
import { ALLOW_ANY_USER_KEY } from "./allow-any-user.decorator.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import { REQUIRE_PERMISSION_KEY } from "../permission/require-permission.decorator.js";
import type { Role } from "../db/schema.js";
import type { JwtUser } from "./jwt-user.js";
import { msg } from "../i18n/index.js";

/**
 * 第二道：角色檢查。
 *
 * ⚠️ **fail-closed**（2026-07-29 改）：沒有宣告存取層級的端點一律拒絕。
 *
 * 原本是 `if (!roles) return true` —— 忘記寫 `@Roles` 的懲罰是**安靜地放行**，
 * 而「忘記寫」與「刻意不限」長得一模一樣。本專案有過先例（分析詳情只擋前端、
 * 後端放行），且接下來要一次補 15 項權限碼，正是最容易漏的時候。
 *
 * 真正危險的形狀不是「員工看到不該看的頁」，是這個：
 *   `@Query("tenantId")` 進來 → service 內部開 aiproot_admin 上下文
 * 漏了 `@Roles` 就能傳別家 tenantId **跨租戶讀資料**。
 *
 * 四種宣告方式，擇一即可：
 *   `@Public()`               不需登入（login / health）
 *   `@Roles(...)`             限定角色
 *   `@RequirePermission(...)` 限定權限碼（交給 PermissionGuard 判）
 *   `@AllowAnyUser()`         刻意不限，但**必須自己保證租戶邊界**
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const cls = context.getClass();
    const targets = [handler, cls];

    // @Public 由 JwtAuthGuard 負責，這裡不重複判
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);

    if (!roles || roles.length === 0) {
      // 有 @RequirePermission 的交給下一道 PermissionGuard，不在這裡擋
      const perms = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRE_PERMISSION_KEY, targets);
      if (perms && perms.length > 0) return true;

      if (this.reflector.getAllAndOverride<boolean>(ALLOW_ANY_USER_KEY, targets)) return true;

      // ⚠️ 走到這裡＝這個端點沒有宣告任何存取層級。
      //    拒絕而不是放行 —— 讓漏寫在開發階段就現形，而不是安靜放行到 prod。
      throw new ForbiddenException(
        `此端點未宣告存取層級（${cls.name}.${handler.name}）· `
        + "請擇一加上 @Roles / @RequirePermission / @AllowAnyUser / @Public",
      );
    }

    const req = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ForbiddenException(msg("srv.auth.roleForbidden"));
    }
    return true;
  }
}
