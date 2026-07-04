// 資料庫存取層 + 每請求租戶隔離的核心。
// withTenant() 開 transaction 並 SET LOCAL app.current_* → RLS 生效；GUC 為 transaction-local，
// 不外洩到連線池其他請求。TenantTxInterceptor 把 tx 放進 txStore（AsyncLocalStorage），service 用 currentTx() 取用。
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";
import type { Role } from "./schema.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export type Db = NodePgDatabase<typeof schema>;

export interface TenantContext {
  tenantId: string | null; // aiproot/consultant 可為 null（跨租戶，靠 role 判斷）
  role: Role;
  departmentId?: string | null; // group_owner 專屬
}

// 當前請求的租戶交易，由 TenantTxInterceptor 注入。
export const txStore = new AsyncLocalStorage<Db>();
export function currentTx(): Db {
  const tx = txStore.getStore();
  if (!tx) {
    throw new Error("無租戶交易上下文：此查詢需在受保護路由（TenantTxInterceptor）內執行");
  }
  return tx;
}

/**
 * 在租戶隔離的 transaction 內執行 fn。SET LOCAL 綁定 session 變數供 RLS policy 使用。
 * 空字串代表未設定：RLS 以 nullif(...,'') 落為 NULL → 拒絕（deny by default）。
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${ctx.tenantId ?? ""}, true)`);
    await tx.execute(sql`SELECT set_config('app.actor_role', ${ctx.role}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_department', ${ctx.departmentId ?? ""}, true)`);
    return fn(tx as unknown as Db);
  });
}

/**
 * 登入查詢專用：set app.auth_lookup=1，讓 users 可跨租戶 SELECT（policy p_users_auth）。
 * 僅供 AuthService.login 找帳號用；仍走最小權限 app_rw，不繞過 RLS 的寫入約束。
 */
export async function withAuthLookup<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.auth_lookup', '1', true)`);
    return fn(tx as unknown as Db);
  });
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
