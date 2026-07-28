import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { Roles } from "../auth/roles.decorator.js";
import { withTenant } from "../db/client.js";

/**
 * 未接住清單（M4）· docs/modules/task-completion-tracking.md §8
 *
 * ⚠️ 這**不是客戶的待辦**，是我們自己的除錯與校準訊號。
 * 收到了引用回覆，但對不上任何任務 —— 原因有兩種，解法相反：
 *
 *   未消化（resolved_at IS NULL）· 批次還沒輪到 → **等就好，不是問題**
 *   no_match                    · 批次跑過仍對不上 → **這才是材料化漏接**
 *
 * 混在一起看會把時序問題誤診成材料化問題，然後拿錯誤的訊號去調門檻，
 * 越調越糟（F-29）。所以兩者分開列、分開計數。
 */
@Controller("completion-signals")
export class CompletionSignalController {
  @Get("unresolved")
  @Roles("aiproot_admin", "consultant")
  async unresolved(@Query("tenantId") tenantId?: string) {
    if (!tenantId) throw new BadRequestException("tenantId 必要");

    return withTenant({ tenantId, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
      const rows = await tx.execute<{
        signal_id: string; intent: string; note: string | null;
        received_at: string; resolution: string | null;
        replier: string | null; quoted_text: string | null; group_name: string | null;
      }>(sql`
        SELECT s.signal_id::text, s.intent, s.note, s.received_at::text, s.resolution,
               COALESCE(m2.display_name, s.replier_display_name) AS replier,
               left(lm.text_content, 120) AS quoted_text,
               lg.display_name AS group_name
          FROM pending_completion_signal s
          LEFT JOIN line_message lm ON lm.message_id = s.quoted_message_id
          LEFT JOIN line_group lg ON lg.group_id = s.group_id
          LEFT JOIN line_member m2 ON m2.group_id = s.group_id AND m2.user_id = s.replier_line_user_id
         WHERE s.tenant_id = ${tenantId}::uuid
           AND (s.resolved_at IS NULL OR s.resolution = 'no_match')
         ORDER BY s.received_at DESC
         LIMIT 200
      `);

      const items = rows.rows.map((r) => ({
        signalId: r.signal_id,
        intent: r.intent,
        note: r.note,
        receivedAt: r.received_at,
        replier: r.replier,
        quotedText: r.quoted_text,
        groupName: r.group_name,
        // 兩種成因要讓看的人一眼分得出來
        reason: r.resolution === "no_match" ? "materialization_gap" : "awaiting_batch",
        reasonLabel: r.resolution === "no_match"
          ? "原訊息不是任務（材料化漏接）"
          : "等下一輪分析",
      }));

      return {
        items,
        counts: {
          awaitingBatch: items.filter((i) => i.reason === "awaiting_batch").length,
          materializationGap: items.filter((i) => i.reason === "materialization_gap").length,
        },
      };
    });
  }

  /**
   * 接住率（M7 的 gate）· 先看這個再看結案率。
   *
   * 若收到 20 則完成回覆卻只對上 3 張任務，問題在**我們的鏈**不在人 ——
   * 那時候去催同仁按按鈕是完全搞錯方向。
   */
  @Get("stats")
  @Roles("aiproot_admin", "consultant")
  async stats(@Query("tenantId") tenantId?: string, @Query("days") days = "14") {
    if (!tenantId) throw new BadRequestException("tenantId 必要");
    const window = Math.min(Math.max(parseInt(days, 10) || 14, 1), 90);

    return withTenant({ tenantId, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
      const sig = await tx.execute<{
        total: number; completion: number; caught: number; gap: number; pending: number;
      }>(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE intent IN ('completion', 'answered_done'))::int AS completion,
               count(*) FILTER (WHERE resolution IN ('closed_ticket', 'created_ticket'))::int AS caught,
               count(*) FILTER (WHERE resolution = 'no_match')::int AS gap,
               count(*) FILTER (WHERE resolved_at IS NULL)::int AS pending
          FROM pending_completion_signal
         WHERE tenant_id = ${tenantId}::uuid
           AND received_at >= now() - ${`${window} days`}::interval
      `);

      const t = await tx.execute<{ done: number; dropped: number; other_closed: number; open: number }>(sql`
        SELECT count(*) FILTER (WHERE work_outcome = '完成')::int AS done,
               count(*) FILTER (WHERE work_outcome = '不用做了')::int AS dropped,
               count(*) FILTER (WHERE work_status = 'closed' AND work_outcome NOT IN ('完成', '不用做了'))::int AS other_closed,
               count(*) FILTER (WHERE work_status = 'open')::int AS open
          FROM tickets
         WHERE tenant_id = ${tenantId}::uuid
           AND created_at >= now() - ${`${window} days`}::interval
      `);

      const s = sig.rows[0], k = t.rows[0];
      const decided = s.total - s.pending;
      // ⚠️ 完成率的分母排除「不用做了」—— 否則取消一堆會被算成做完一堆
      const denom = k.done + k.other_closed + k.open;

      return {
        windowDays: window,
        signals: {
          total: s.total, completion: s.completion, caught: s.caught,
          materializationGap: s.gap, awaitingBatch: s.pending,
          // 已經判定過的裡面接住幾成 · 還沒輪到的不算進分母
          catchRate: decided > 0 ? Math.round((s.caught / decided) * 100) : null,
        },
        tickets: {
          done: k.done, dropped: k.dropped, otherClosed: k.other_closed, open: k.open,
          closeRate: denom > 0 ? Math.round(((k.done + k.other_closed) / denom) * 100) : null,
          formula: "結案率 ＝ (完成 ＋ 其他結束) ÷ (完成 ＋ 其他結束 ＋ 尚未確認完成) · 分母排除「不用做了」",
        },
      };
    });
  }
}
