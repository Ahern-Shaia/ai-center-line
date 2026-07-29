import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { SchedulerId } from "./scheduler-config.repository.js";

/**
 * 「AI 幾點會整理」的人話版本。
 *
 * ⚠️ 這個時間**不可以寫死**。它是 per-tenant 的（`scheduler_config` 有 tenant override，
 * prod 實例：台灣福祉自己把批次改成 18:00），而畫面上與 bot 回覆卻一直寫「17:30」——
 * 客戶把時間改掉之後，系統就在對他說謊，而且沒有任何地方會報錯。
 *
 * 回 null 代表關閉或查不到，呼叫端要據此改寫文案（不要顯示一個假的時間）。
 */
export async function schedulerTimeLabel(
  tx: Db, tenantId: string | null, schedulerId: SchedulerId,
): Promise<string | null> {
  const r = await tx.execute<{ cron_expr: string; enabled: boolean }>(sql`
    SELECT cron_expr, enabled FROM scheduler_config
     WHERE scheduler_id = ${schedulerId}
       AND (tenant_id = ${tenantId}::uuid OR tenant_id IS NULL)
     ORDER BY tenant_id NULLS LAST      -- 租戶自己的設定優先於平台預設
     LIMIT 1`);
  const row = r.rows[0];
  if (!row || !row.enabled) return null;
  return hhmmOf(row.cron_expr);
}

/** `30 17 * * *` → `17:30`。看不懂的 cron（例如每小時跑）回 null，讓呼叫端改用泛稱 */
export function hhmmOf(cronExpr: string): string | null {
  const [min, hour] = cronExpr.trim().split(/\s+/);
  if (!/^\d{1,2}$/.test(min ?? "") || !/^\d{1,2}$/.test(hour ?? "")) return null;
  return `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
}
