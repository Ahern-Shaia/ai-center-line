import { ForbiddenException } from "@nestjs/common";
import type { JwtUser } from "./jwt-user.js";

/** 只有平台角色可以指定要看哪一家 */
const PLATFORM_ROLES = new Set(["aiproot_admin", "consultant"]);

/**
 * 決定這次請求要用哪個 tenantId。
 *
 * ⚠️ **不可以直接信 `@Query("tenantId")`。**
 *
 * 2026-07-29 實測到的跨租戶 IDOR：
 * `TenantTxInterceptor` 已經依 JWT 設好 `app.current_tenant`，
 * 但 service 若再呼叫 `setTenantContext(tx, <client 傳的 tenantId>)`
 * 就會**把它覆蓋掉** —— A 公司的 tenant_admin 傳 B 的 tenantId，
 * 讀得到 B 的部門（已用 scratch 重現）。
 *
 * `@RequirePermission("departments:view")` 擋不住這個：
 * 它檢查的是「這個人有沒有這個權限」，不是「這筆資料是不是他家的」。
 *
 * 規則：
 *   平台角色（aiproot_admin / consultant）→ 可指定任一 tenantId（本來就跨租戶）
 *   其他角色                              → **一律用自己的**，傳別家直接擋
 */
export function resolveTenantId(user: JwtUser, requested?: string | null): string {
  if (PLATFORM_ROLES.has(user.role)) {
    const t = requested || user.tenant_id;
    if (!t) throw new ForbiddenException("需指定 tenantId");
    return t;
  }

  if (!user.tenant_id) throw new ForbiddenException("此帳號未歸屬租戶");

  // 傳了別家的 → 擋。不要靜默改成自己的，那會讓前端以為切換成功
  if (requested && requested !== user.tenant_id) {
    throw new ForbiddenException("不可查詢其他租戶的資料");
  }
  return user.tenant_id;
}

/**
 * 列表端點用的變體：平台角色**不傳就是看全部**（回 undefined）。
 *
 * `resolveTenantId` 對平台角色不傳會丟「需指定 tenantId」，
 * 但像「對話分析歷程」「LINE 機器人」這種跨租戶清單，不傳本來就等於全平台。
 * 其他角色的規則完全相同 —— 一律鎖在自己家。
 */
export function resolveTenantFilter(user: JwtUser, requested?: string | null): string | undefined {
  if (PLATFORM_ROLES.has(user.role)) return requested || undefined;
  return resolveTenantId(user, requested);
}
