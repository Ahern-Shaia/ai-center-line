import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

// 通知設定 UI 的輔助查詢
// v3 起「規則」本體由 notification-hub/RuleRepository 負責（notification_rule）；
// 本 repo 只留設定 UI 需要的周邊查詢。
@Injectable()
export class NotifyConfigRepository {
  /** 該 Ragic 帳號對應租戶的 LINE 群（供設定 UI 下拉）· 沿用 line-ingest 的 line_group */
  async listLineGroupsForAccount(tx: Db, accountId: string): Promise<Array<{ groupId: string; displayName: string | null }>> {
    const res = await tx.execute<{ group_id: string; display_name: string | null }>(sql`
      SELECT g.group_id, g.display_name
      FROM ragic_account a
      JOIN line_bot b   ON b.tenant_id = a.tenant_id AND b.status = 'active'
      JOIN line_group g ON g.bot_id = b.bot_id
      WHERE a.account_id = ${accountId}::uuid
      ORDER BY g.display_name NULLS LAST
    `);
    return res.rows.map((r) => ({ groupId: r.group_id, displayName: r.display_name }));
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
  async getAccountTenantId(tx: Db, accountId: string): Promise<string | null> {
    const res = await tx.execute<{ tenant_id: string | null }>(sql`
      SELECT tenant_id FROM ragic_account WHERE account_id = ${accountId}::uuid LIMIT 1
    `);
    return res.rows[0]?.tenant_id ?? null;
  }
}
