import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, from, firstValueFrom } from "rxjs";
import { withTenant, txStore, type TenantContext } from "../db/client.js";
import { auditLog } from "../db/schema.js";
import type { JwtUser } from "../auth/jwt-user.js";

// 全域 interceptor：受保護請求包一個租戶交易（RLS 生效）＋寫 audit_log。
// 「一次寫、全域強制」——新路由自動套用，不會漏（選 NestJS 的理由）。公開路由（無 req.user）跳過。
//
// ⚠️ 只有「資料範圍就是單一部門」的角色才帶 department 進 app.current_department。
//    migration 0048 把 tickets RLS 改成「有帶 current_department 就只看該部門」，並明說
//    「由後端決定要不要設」——但這裡原本對所有角色都帶 user.department_id。
//    後果（2026-08-03 台灣福祉 GM 實際踩到）：tenant_admin 若個人掛了部門
//    （例：總經理室 GM 掛在「總經理室」部門供組織圖顯示），就被 0048 鎖進單一部門，
//    任務看板整個清空。tenant_admin / assistant / consultant / aiproot 看全租戶（或跨租戶），
//    不該因個人部門被鎖。group_owner / employee 才是「限定在自己部門」的角色（保留 0048 收斂）。
//    註：personal_daily_report_scope policy 本來就有 tenant_admin 逃生條款，不受影響；
//        改這裡讓 tickets 與那條 policy 的 tenant_admin 行為一致。
const DEPT_SCOPED_ROLES = new Set(["group_owner", "employee"]);

/** RLS 用的 current_department：只有部門限定角色才帶自己的部門，其餘（看全租戶者）一律 null。 */
export function contextDepartmentFor(role: string, departmentId: string | null | undefined): string | null {
  return DEPT_SCOPED_ROLES.has(role) ? (departmentId ?? null) : null;
}

@Injectable()
export class TenantTxInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ method: string; url: string; user?: JwtUser }>();
    const user = req.user;
    if (!user) return next.handle();

    const ctx: TenantContext = {
      tenantId: user.tenant_id ?? null,
      role: user.role,
      departmentId: contextDepartmentFor(user.role, user.department_id),
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
