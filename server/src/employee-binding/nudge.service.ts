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
      const { rows, total } = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.findUnboundActiveUsers(tx, t.tenant_id, 7));
      results.push({
        tenantId: t.tenant_id,
        tenantName: t.tenant_name,
        unboundCount: total,
        top: rows.map((r) => ({
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
   * 單一租戶未綁定活躍者 · 供 tenant_admin 自租戶 audit 頁用
   * · tenantId 一律由 caller 從 JWT 取（不接受 client 傳入）· 避免跨租戶窺看
   * · 走 aiproot_admin 上下文只為讓 line_member 的 display_name JOIN 得到值
   *   （line_member RLS 不開 tenant_admin · 見矩陣 §4.1）· 查詢本身已 lm.tenant_id 綁死該租戶
   */
  async computeUnboundStatsForTenant(tenantId: string): Promise<{
    tenantId: string;
    tenantName: string;
    unboundCount: number;
    top: Array<{ senderLineId: string; displayName: string | null; messageCount: number; topGroupName: string | null }>;
  }> {
    const nameRes = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => tx.execute<{ tenant_name: string }>(sql`
      SELECT tenant_name FROM tenants WHERE tenant_id = ${tenantId}::uuid
    `));
    const { rows, total } = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.findUnboundActiveUsers(tx, tenantId, 7));
    return {
      tenantId,
      tenantName: nameRes.rows[0]?.tenant_name ?? "",
      unboundCount: total,
      top: rows.map((r) => ({
        senderLineId: r.senderLineId,
        displayName: r.displayName,
        messageCount: r.messageCount,
        topGroupName: r.topGroupName,
      })),
    };
  }

  /**
   * 查未綁定活躍者 · inline SQL 避免依賴 LineMessageRepository
   * 邏輯對照原 LineMessageRepository.findUnboundActiveUsers
   */
  private async findUnboundActiveUsers(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    tenantId: string,
    lookbackDays: number,
  ): Promise<{
    rows: Array<{
      senderLineId: string;
      displayName: string | null;
      messageCount: number;
      lastActiveAt: string;
      topGroupName: string | null;
    }>;
    total: number;
  }> {
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
      total_count: number;
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
      SELECT a.sender_line_id,
             -- 純量子查詢取單一名字：line_member 一人多群會有多列 · 用 JOIN 會把 activity 乘出重複列
             (SELECT m.display_name FROM line_member m
               WHERE m.user_id = a.sender_line_id AND m.fetch_error IS NULL
               ORDER BY m.display_name NULLS LAST
               LIMIT 1) AS display_name,
             a.message_count, a.last_active_at, a.top_group_name,
             (SELECT count(*)::int FROM activity) AS total_count   -- 真實總數（不受 LIMIT · 去重人數）
      FROM activity a
      ORDER BY a.message_count::int DESC
      LIMIT 100
    `);
    return {
      rows: res.rows.map((r) => ({
        senderLineId: r.sender_line_id,
        displayName: r.display_name,
        messageCount: parseInt(r.message_count, 10),
        lastActiveAt: r.last_active_at,
        topGroupName: r.top_group_name,
      })),
      total: res.rows[0]?.total_count ?? 0,
    };
  }
}
