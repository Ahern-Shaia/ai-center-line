import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

// 通知設定 UI 的輔助查詢
// v3 起「規則」本體由 notification-hub/RuleRepository 負責（notification_rule）；
// 本 repo 只留設定 UI 需要的周邊查詢。
@Injectable()
export class NotifyConfigRepository {
  /**
   * 目標群下拉用 · 所有看得到的 LINE 群（帶租戶名，因為 aiproot 一個人管多家）。
   *
   * ⚠️ 刻意**不經過 `ragic_account`**。原本只有 `listLineGroupsForAccount(accountId)`，
   * 它從 ragic 帳號 join 到租戶再 join 到 bot —— 但 prod 上三個 ragic 帳號的
   * `tenant_id` **全是 NULL**，那條 join 一列都回不來，所以下拉永遠是空的、
   * 前端永遠掉回「手貼 group id」。而系統事件那條路根本沒有 ragic 帳號，本來就用不到那支。
   *
   * ⚠️ 這裡不自己過濾租戶 —— 交給 `line_group` 的 RLS：
   * aiproot / consultant 看得到全部，其他角色只看得到自己租戶的。
   */
  async listAllLineGroups(tx: Db): Promise<Array<{
    groupId: string; displayName: string | null; tenantName: string | null;
  }>> {
    const res = await tx.execute<{
      group_id: string; display_name: string | null; tenant_name: string | null;
    }>(sql`
      SELECT g.group_id, g.display_name, t.tenant_name
        FROM line_group g
        JOIN line_bot b     ON b.bot_id = g.bot_id AND b.status = 'active'
        LEFT JOIN tenants t ON t.tenant_id = b.tenant_id
       ORDER BY t.tenant_name NULLS LAST, g.display_name NULLS LAST, g.group_id
    `);
    return res.rows.map((r) => ({
      groupId: r.group_id, displayName: r.display_name, tenantName: r.tenant_name,
    }));
  }

  /** 列表顯示用 · groupId → 群名 */
  async listAllLineGroupNames(tx: Db): Promise<Record<string, string>> {
    const res = await tx.execute<{ group_id: string; display_name: string | null }>(sql`
      SELECT group_id, display_name FROM line_group
    `);
    const out: Record<string, string> = {};
    for (const r of res.rows) if (r.display_name) out[r.group_id] = r.display_name;
    return out;
  }

  /** 列表顯示用 · userId → 成員名 */
  async listAllUserNames(tx: Db): Promise<Record<string, string>> {
    const res = await tx.execute<{ user_id: string; name: string }>(sql`
      SELECT user_id, COALESCE(NULLIF(display_name, ''), email) AS name FROM users
    `);
    const out: Record<string, string> = {};
    for (const r of res.rows) out[r.user_id] = r.name;
    return out;
  }

  /** 建規則時由帳號帶出 tenant（不信任前端）*/
  /**
   * 這個群組真的屬於這支 bot 嗎？—— 存規則前的最後一道閘。
   * LINE 的群組 ID 依 bot 發放，跨 bot 使用會在真實事件發生時才 400，
   * 那時使用者已經忘了自己設過什麼（2026-08-12 鮮湧事故）。
   */
  async groupBelongsToBot(tx: Db, botId: string, groupId: string): Promise<boolean> {
    const res = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM line_group
      WHERE bot_id = ${botId}::uuid AND group_id = ${groupId} AND status = 'active'
    `);
    return (res.rows[0]?.n ?? 0) > 0;
  }

  async getAccountTenantId(tx: Db, accountId: string): Promise<string | null> {
    const res = await tx.execute<{ tenant_id: string | null }>(sql`
      SELECT tenant_id FROM ragic_account WHERE account_id = ${accountId}::uuid LIMIT 1
    `);
    return res.rows[0]?.tenant_id ?? null;
  }
}
