import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import type { JwtUser } from "../auth/jwt-user.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { resolveTenantId } from "../auth/resolve-tenant-id.js";
import { sql } from "drizzle-orm";
import { RequirePermission } from "../permission/require-permission.decorator.js";
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
  @RequirePermission("completion-tracking:view")
  async unresolved(@CurrentUser() user: JwtUser, @Query("tenantId") tenantId?: string) {
    const t = resolveTenantId(user, tenantId);
    return withTenant({ tenantId: t, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
      const rows = await tx.execute<{
        signal_id: string; intent: string; note: string | null;
        received_at: string; resolution: string | null; resolved_ticket_id: string | null;
        replier: string | null; quoted_text: string | null; group_name: string | null;
      }>(sql`
        SELECT s.signal_id::text, s.intent, s.note, s.received_at::text, s.resolution,
               s.resolved_ticket_id::text,
               COALESCE(m2.display_name, s.replier_display_name) AS replier,
               left(lm.text_content, 120) AS quoted_text,
               lg.display_name AS group_name
          FROM pending_completion_signal s
          LEFT JOIN line_message lm ON lm.message_id = s.quoted_message_id
          LEFT JOIN line_group lg ON lg.group_id = s.group_id
          LEFT JOIN line_member m2 ON m2.group_id = s.group_id AND m2.user_id = s.replier_line_user_id
         WHERE s.tenant_id = ${t}::uuid
           AND (
             s.resolved_at IS NULL
             OR s.resolution = 'no_match'
             -- 掛到的任務後來被刪了（ON DELETE SET NULL）· 標籤還說接住了，
             -- 但點進去沒有東西 —— 這種要回到未接住清單（Bug B）
             OR (s.resolution IS NOT NULL AND s.resolution <> 'no_match'
                 AND s.resolved_ticket_id IS NULL)
           )
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
        // 三種成因要讓看的人一眼分得出來
        reason: reasonOf(r),
        reasonLabel: REASON_LABEL[reasonOf(r)],
      }));

      return {
        items,
        counts: {
          awaitingBatch: items.filter((i) => i.reason === "awaiting_batch").length,
          materializationGap: items.filter((i) => i.reason === "materialization_gap").length,
          ticketGone: items.filter((i) => i.reason === "ticket_gone").length,
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
  @RequirePermission("completion-tracking:view")
  async stats(@CurrentUser() user: JwtUser, @Query("tenantId") tenantId?: string, @Query("days") days = "14") {
    // ⚠️ 變數叫 t 會被下面的 `const t = await tx.execute(...)` 遮蔽，
    //    而原本兩個查詢的 WHERE 用的是**沒解析過的** query 參數 `tenantId` ——
    //    租戶自己不傳 tenantId 時就是 `WHERE tenant_id = NULL`，整頁靜默空白。
    const scopedTenantId = resolveTenantId(user, tenantId);
    const window = Math.min(Math.max(parseInt(days, 10) || 14, 1), 90);

    return withTenant({ tenantId: scopedTenantId, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
      const sig = await tx.execute<{
        total: number; completion: number; caught: number; closed_by_reply: number;
        ticket_gone: number; gap: number; pending: number;
      }>(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE intent IN ('completion', 'answered_done'))::int AS completion,
               -- 接住＝對上了某張任務**而且那張任務還在**
               count(*) FILTER (
                 WHERE resolution IN ('closed_ticket', 'progress_logged', 'created_ticket')
                   AND resolved_ticket_id IS NOT NULL)::int AS caught,
               -- 真的把任務關掉的 · 跟「接住」是兩件事（進度回報也算接住）
               count(*) FILTER (WHERE resolution = 'closed_ticket'
                                  AND resolved_ticket_id IS NOT NULL)::int AS closed_by_reply,
               -- 標籤說接住了，但任務已被刪除（Bug B）
               count(*) FILTER (WHERE resolution IS NOT NULL AND resolution <> 'no_match'
                                  AND resolved_ticket_id IS NULL)::int AS ticket_gone,
               count(*) FILTER (WHERE resolution = 'no_match')::int AS gap,
               count(*) FILTER (WHERE resolved_at IS NULL)::int AS pending
          FROM pending_completion_signal
         WHERE tenant_id = ${scopedTenantId}::uuid
           AND received_at >= now() - ${`${window} days`}::interval
      `);

      const t = await tx.execute<{ done: number; dropped: number; other_closed: number; open: number }>(sql`
        SELECT count(*) FILTER (WHERE work_outcome = '完成')::int AS done,
               count(*) FILTER (WHERE work_outcome = '不用做了')::int AS dropped,
               count(*) FILTER (WHERE work_status = 'closed' AND work_outcome NOT IN ('完成', '不用做了'))::int AS other_closed,
               count(*) FILTER (WHERE work_status = 'open')::int AS open
          FROM tickets
         WHERE tenant_id = ${scopedTenantId}::uuid
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
          closedByReply: s.closed_by_reply, ticketGone: s.ticket_gone,
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

type UnresolvedReason = "awaiting_batch" | "materialization_gap" | "ticket_gone";

const REASON_LABEL: Record<UnresolvedReason, string> = {
  awaiting_batch: "等下一輪分析",
  materialization_gap: "原訊息不是任務（材料化漏接）",
  ticket_gone: "掛到的任務已被刪除",
};

/**
 * 為什麼還沒接住。
 * ⚠️ `ticket_gone` 是**算出來的**不是存的：`resolved_ticket_id` 是
 * `ON DELETE SET NULL`，所以連結在不在隨時查得到。存一份到 DB 就要再寫一支
 * 同步邏輯，而那支一旦漏跑就又是一組對不上的標籤。
 */
function reasonOf(r: { resolution: string | null; resolved_ticket_id: string | null }): UnresolvedReason {
  if (r.resolution === "no_match") return "materialization_gap";
  if (r.resolution !== null && r.resolved_ticket_id === null) return "ticket_gone";
  return "awaiting_batch";
}
