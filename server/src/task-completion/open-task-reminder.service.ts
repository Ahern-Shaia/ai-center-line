import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { withTenant, withSystemTx } from "../db/client.js";
import { isDailyReport, tierFor } from "./daily-report-pattern.js";
import { TaskConfigService } from "../task-config/task-config.service.js";

/**
 * 每日回報 → 回覆「尚未確認完成」清單（M3.5）
 * docs/modules/task-completion-tracking.md §2.3
 *
 * 這是當責人**唯一看得到自己手上有什麼**的地方 ——
 * 他們沒有系統帳號（prod 20 張任務有名字、0 張對得上帳號），
 * 所以網頁那一區對他們不存在。
 *
 * 四個約束（少一個就會長成催辦，也就是釘釘那條路）：
 *   · 只回**他自己發的那則**回報 —— 沒發就不發
 *   · 只用 reply token，**不用 push**（技術上就擋掉主動打擾）
 *   · 0 件不回（連「今天沒有待確認的」都不要回）
 *   · 每人每日至多 1 則
 *
 * ⚠️ 呼叫時機：**webhook 的 tx 結束之後**。
 * 這裡要讀寫 tickets，而 tickets 的 RLS 是 AND-only、沒有 actor_role 逃生門 ——
 * 在 webhook 的 withSystemTx 底下查會**靜默回 0 筆**（不報錯），
 * 整個提醒會安靜地什麼都不做。所以本服務自己開 tenant 上下文。
 */
@Injectable()
export class OpenTaskReminderService {
  private readonly logger = new Logger(OpenTaskReminderService.name);

  constructor(private readonly taskConfig: TaskConfigService) {}

  /** @returns 要回的話 · null = 不回 */
  async replyForDailyReport(args: {
    tenantId: string;
    groupId: string;
    senderLineUserId: string;
    text: string;
  }): Promise<string | null> {
    if (!isDailyReport(args.text)) return null;

    // 身分：LINE user → 群內顯示名 → 比對 assignee_display_name
    // ⚠️ 已知的降級路徑（F-23）：display_name 是文字不是身分，同名／改暱稱會對錯。
    //    但要求先綁定帳號等於這功能沒人能用（prod 綁定 4/44）。
    const who = await withSystemTx((tx) => tx.execute<{ display_name: string | null }>(sql`
      SELECT display_name FROM line_member
       WHERE group_id = ${args.groupId} AND user_id = ${args.senderLineUserId}
       LIMIT 1
    `));
    const name = who.rows[0]?.display_name?.trim();
    if (!name) return null;

    return withTenant(
      { tenantId: args.tenantId, role: "tenant_admin", departmentId: null, userId: null },
      async (tx) => {
        // 今天已經回過就不再回
        const already = await tx.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM tickets
           WHERE tenant_id = ${args.tenantId}::uuid
             AND work_reminded_line_user_id = ${args.senderLineUserId}
             AND work_reminded_at >= date_trunc('day', now())
        `);
        if ((already.rows[0]?.n ?? 0) > 0) return null;

        const open = await tx.execute<{
          ticket_id: string; summary: string | null; open_days: number; last_note: string | null;
        }>(sql`
          SELECT ticket_id::text, summary,
                 (now()::date - created_at::date)::int AS open_days,
                 work_last_report_note AS last_note
            FROM tickets
           WHERE tenant_id = ${args.tenantId}::uuid
             AND work_status = 'open'
             AND assignee_display_name = ${name}
             -- 只帶「已經被認可是任務」的 —— 待確認的還沒被主管收為任務，
             -- 提早出現在同仁面前等於要他做一件公司還沒決定要做的事
             AND confirm_status IN ('待簽核', '已簽核', '逾時警示')
           ORDER BY created_at
           LIMIT 20
        `);

        // 超過後段的不再對他重複，改由主管端處理（F-25 升級階梯）
        // 階梯天數每家不一樣（維修 7 天合理、詢價太長）· tenant_task_config
        const { tierDays } = await this.taskConfig.forTenant(tx, args.tenantId);
        const mine = open.rows.filter((r) => tierFor(r.open_days, tierDays) !== "escalate");
        if (mine.length === 0) return null;

        await tx.execute(sql`
          UPDATE tickets
             SET work_reminded_at = now(), work_reminded_line_user_id = ${args.senderLineUserId}
           WHERE ticket_id = ANY(ARRAY(SELECT jsonb_array_elements_text(
                 ${JSON.stringify(mine.map((r) => r.ticket_id))}::jsonb))::uuid[])
        `);

        this.logger.log(`[reminder] ${name} · ${mine.length} 件尚未確認完成 · group=${args.groupId}`);
        return compose(mine, tierDays);
      },
    );
  }
}

/**
 * ⚠️ 措辭鐵則（F-26）：說「尚未確認完成」不說「未完成」。
 * 後者說的是工作狀態 —— 人做完但還沒回報時它是**假的**，
 * 而那正是讓人不再信任提醒的原因。
 */
function compose(
  rows: Array<{ summary: string | null; open_days: number; last_note: string | null }>,
  tierDays: [number, number],
): string {
  const lines = rows.map((r) => {
    const title = (r.summary ?? "（無標題）").split("\n")[0].slice(0, 40);
    const aged = tierFor(r.open_days, tierDays) === "aged" ? `已 ${r.open_days} 天未確認` : `第 ${r.open_days} 天`;
    const note = r.last_note ? ` · 最後回報：${r.last_note.split("\n")[0].slice(0, 20)}` : "";
    return `· ${title}（${aged}${note}）`;
  });
  return [
    "✓ 已收到今日回報",
    `以下 ${rows.length} 件尚未確認完成：`,
    ...lines,
    "做完了就引用那則訊息回一句就好",
  ].join("\n");
}
