import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, from, firstValueFrom } from "rxjs";
import { withTenant, txStore, type TenantContext } from "../db/client.js";
import { auditLog } from "../db/schema.js";
import type { JwtUser } from "../auth/jwt-user.js";

// 全域 interceptor：受保護請求包一個租戶交易（RLS 生效）＋寫 audit_log。
// 「一次寫、全域強制」——新路由自動套用，不會漏（選 NestJS 的理由）。公開路由（無 req.user）跳過。
@Injectable()
export class TenantTxInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ method: string; url: string; user?: JwtUser }>();
    const user = req.user;
    if (!user) return next.handle();

    const ctx: TenantContext = {
      tenantId: user.tenant_id ?? null,
      role: user.role,
      departmentId: user.department_id ?? null,
      userId: user.user_id,
    };
    const action = `${req.method} ${req.url}`;

    return from(
      withTenant(ctx, async (tx) =>
        txStore.run(tx, async () => {
          const result = await firstValueFrom(next.handle());
          await tx.insert(auditLog).values({
            actorUserId: user.user_id,
            actorRole: user.role,
            action,
            tenantId: user.tenant_id ?? null,
            result: "allowed",
          });
          return result;
        }),
      ),
    );
  }
}
