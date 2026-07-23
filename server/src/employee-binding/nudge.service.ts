import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import { withTenant } from "../db/client.js";

/**
 * Nudge Service · 未綁定偵測工具 · 方向 3（不當綁定 · 只提示）
 * 對照 employee-line-binding.md §6.9 · §7-quinque.13
 *
 * 定期掃活躍但未綁定的 LINE UserId · 提示 aiproot 業助追人綁定
 * · 每日 09:00 台北 (aiproot 業助上班時已算好)
 *
 * SQL inline · 不依賴 LineMessageRepository · 避免 LineIngestModule 環回
 */
@Injectable()
export class NudgeService {
  private readonly logger = new Logger(NudgeService.name);

  /**
   * 每日 09:00 台北 · 記 log · 前端 dashboard 觸發實際計算
   */
  @Cron("0 9 * * *", { timeZone: "Asia/Taipei" })
  async handleDailyNudge(): Promise<void> {
    if (process.env.NUDGE_CRON_ENABLED === "false") {
      this.logger.log("NUDGE_CRON_ENABLED=false · skip");
      return;
    }
    const stats = await this.computeUnboundStats();
    const total = stats.reduce((s, r) => s + r.unboundCount, 0);
    this.logger.log(`Nudge cron · ${stats.length} tenants · ${total} unbound active UserIds`);
  }

  /**
   * 計算所有 tenant 未綁定活躍者 · 供 aiproot audit 頁 UI 用
   * (aiproot admin 也可手動觸發)
   */
  async computeUnboundStats(): Promise<Array<{
    tenantId: string;
    tenantName: string;
    unboundCount: number;
    top: Array<{ senderLineId: string; displayName: string | null; messageCount: number; topGroupName: string | null }>;
  }>> {
    // tenants + line_message RLS 需 aiproot_admin 角色跨租戶讀 · withTenant tenantId=null + role=aiproot_admin
    const tenantsRes = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => tx.execute<{ tenant_id: string; tenant_name: string }>(sql`
      SELECT tenant_id::text, tenant_name FROM tenants
    `));

    const results: Array<{
      tenantId: string; tenantName: string; unboundCount: number;
      top: Array<{ senderLineId: string; displayName: string | null; messageCount: number; topGroupName: string | null }>;
    }> = [];

    for (const t of tenantsRes.rows) {
      const unbound = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.findUnboundActiveUsers(tx, t.tenant_id, 7));
      results.push({
        tenantId: t.tenant_id,
        tenantName: t.tenant_name,
        unboundCount: unbound.length,
        top: unbound.slice(0, 10).map((r) => ({
          senderLineId: r.senderLineId,
          displayName: r.displayName,
          messageCount: r.messageCount,
          topGroupName: r.topGroupName,
        })),
      });
    }
    return results;
  }

  /**
   * 查未綁定活躍者 · inline SQL 避免依賴 LineMessageRepository
   * 邏輯對照原 LineMessageRepository.findUnboundActiveUsers
   */
  private async findUnboundActiveUsers(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    tenantId: string,
    lookbackDays: number,
  ): Promise<Array<{
    senderLineId: string;
    displayName: string | null;
    messageCount: number;
    lastActiveAt: string;
    topGroupName: string | null;
  }>> {
    // v2 · 加 lg.department_id IS NOT NULL filter
    // 修跨租戶洩漏：若 bot A 被誤加進 tenant B 的群 · tenant B 端 line_group.department_id 應為 null
    // (aiproot 未分派 · 因該群不屬 tenant B) · 有這 filter 就能擋掉未正確配置的資料
    // 對照矩陣文件 §4.1 line_message RLS 已 tenant scope · 這裡加第 2 層 defense
    const res = await tx.execute<{
      sender_line_id: string;
      display_name: string | null;
      message_count: string;
      last_active_at: string;
      top_group_name: string | null;
    }>(sql`
      WITH activity AS (
        SELECT lm.sender_line_id,
               count(*)::text AS message_count,
               max(lm.sent_at)::text AS last_active_at,
               mode() WITHIN GROUP (ORDER BY lg.display_name) AS top_group_name
        FROM line_message lm
        JOIN line_group lg ON lg.bot_id = lm.bot_id AND lg.group_id = lm.group_id
        LEFT JOIN user_line_binding b
          ON b.bot_id = lm.bot_id
         AND b.line_user_id = lm.sender_line_id
         AND b.status = 'active'
        WHERE lm.tenant_id = ${tenantId}::uuid
          AND lg.department_id IS NOT NULL                   -- v2 · 只算已分派部門的群
          AND lm.sent_at > (now() - (${lookbackDays} || ' days')::interval)
          AND lm.sender_line_id IS NOT NULL
          AND b.binding_id IS NULL
        GROUP BY lm.sender_line_id
      )
      SELECT a.sender_line_id, mem.display_name,
             a.message_count, a.last_active_at, a.top_group_name
      FROM activity a
      LEFT JOIN line_member mem
        ON mem.user_id = a.sender_line_id
       AND mem.fetch_error IS NULL
      ORDER BY a.message_count::int DESC
      LIMIT 100
    `);
    return res.rows.map((r) => ({
      senderLineId: r.sender_line_id,
      displayName: r.display_name,
      messageCount: parseInt(r.message_count, 10),
      lastActiveAt: r.last_active_at,
      topGroupName: r.top_group_name,
    }));
  }
}
