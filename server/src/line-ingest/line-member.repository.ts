import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

/**
 * line_member repository · LINE 群組成員 displayName cache
 * UNIQUE (bot_id, group_id, user_id) · 冪等 upsert
 */
@Injectable()
export class LineMemberRepository {
  async upsert(tx: Db, args: {
    tenantId: string;
    botId: string;
    groupId: string;
    userId: string;
    displayName: string;
    pictureUrl: string | null;
  }): Promise<void> {
    await tx.execute(sql`
      INSERT INTO line_member (
        tenant_id, bot_id, group_id, user_id, display_name, picture_url,
        first_seen_at, last_seen_at, updated_at
      ) VALUES (
        ${args.tenantId}::uuid, ${args.botId}::uuid, ${args.groupId}, ${args.userId},
        ${args.displayName}, ${args.pictureUrl ?? null},
        now(), now(), now()
      )
      ON CONFLICT (bot_id, group_id, user_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        picture_url = EXCLUDED.picture_url,
        last_seen_at = now(),
        updated_at = now(),
        fetch_error = NULL
    `);
  }

  async recordFailure(tx: Db, args: {
    tenantId: string;
    botId: string;
    groupId: string;
    userId: string;
    error: string;
  }): Promise<void> {
    // 失敗也記 row · display_name 用 pseudonym placeholder · 供 aiproot audit
    // 未來 retry job 可 SELECT WHERE fetch_error IS NOT NULL
    await tx.execute(sql`
      INSERT INTO line_member (
        tenant_id, bot_id, group_id, user_id, display_name, fetch_error, updated_at
      ) VALUES (
        ${args.tenantId}::uuid, ${args.botId}::uuid, ${args.groupId}, ${args.userId},
        ${"成員_" + args.userId.slice(-6)}, ${args.error}, now()
      )
      ON CONFLICT (bot_id, group_id, user_id) DO UPDATE SET
        fetch_error = EXCLUDED.fetch_error,
        updated_at = now()
    `);
  }

  async exists(tx: Db, botId: string, groupId: string, userId: string): Promise<boolean> {
    const res = await tx.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM line_member
      WHERE bot_id = ${botId}::uuid AND group_id = ${groupId} AND user_id = ${userId}
    `);
    return parseInt(res.rows[0]?.n ?? "0", 10) > 0;
  }
}
