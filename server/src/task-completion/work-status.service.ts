import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";
import type { WorkOutcome } from "../warroom-task-board/ticket-lane.js";
import { msg } from "../i18n/index.js";

const OUTCOMES: readonly WorkOutcome[] = ["完成", "不用做了", "轉他人", "做不到"];

/**
 * 當責人自己能用的結果 —— 只有兩個（docs/modules/task-close-by-assignee.md OQ-TCA-8）。
 *
 * 「轉他人」要指定對象、「做不到」要填卡在哪，兩者都是另一段流程；
 * 塞進日報那一列會讓它從「清掉手上的東西」變成「填表」。
 */
const ASSIGNEE_OUTCOMES: readonly WorkOutcome[] = ["完成", "不用做了"];

/**
 * 網頁端的補登與還原（M5）· docs/modules/task-completion-tracking.md §7
 *
 * ⚠️ 這條路徑是**補登**，不是主要入口。
 * 主要入口是 LINE 引用回覆（當責人 0 人有系統帳號）——
 * 這裡給的是主管：他有帳號，而且是那個佇列的洩壓閥（doc §2.5）。
 *
 * ⚠️ 代結案是**必然不是例外**（Jira 的 Only-Assignee 是 opt-in、Asana 根本沒這權限）。
 * 寫死「只有當責人能改」第一週就會被要求開後門。
 * 所以允許，但一定記下 work_closed_by，且 UI 明示「由 ○○ 代為結束」。
 */
@Injectable()
export class WorkStatusService {
  private readonly logger = new Logger(WorkStatusService.name);

  async close(ticketId: string, outcome: string, note: string | null, actorUserId: string) {
    if (!OUTCOMES.includes(outcome as WorkOutcome)) {
      throw new BadRequestException(`結束原因不正確 · 只能是：${OUTCOMES.join("／")}`);
    }
    const tx = currentTx();
    const r = await tx.execute<{ ticket_id: string; work_status: string }>(sql`
      UPDATE tickets
         SET work_status = 'closed',
             work_outcome = ${outcome},
             work_closed_at = now(),
             work_closed_by = ${actorUserId}::uuid,
             work_closed_via = 'web',
             work_note = ${note},
             updated_at = now()
       WHERE ticket_id = ${ticketId}::uuid
         -- 已經結束的不再蓋一次 · 要改請先還原（避免把 LINE 回報的紀錄悄悄換掉）
         AND work_status = 'open'
      RETURNING ticket_id::text, work_status
    `);
    if (r.rows.length === 0) {
      throw new NotFoundException(msg("srv.work.closedAlready"));
    }
    this.logger.log(`work close · ticket=${ticketId} outcome=${outcome} by=${actorUserId}`);
    return { ticketId, workStatus: "closed", workOutcome: outcome };
  }

  /**
   * 還原成「尚未確認完成」。
   *
   * ⚠️ 一定要能還原：標錯了沒有補救途徑的話，人就不敢按了（doc F-4）。
   * 還原時把所有結束相關欄位一起清掉 —— 留半套會讓跨軸約束擋下下一次寫入。
   */
  async reopen(ticketId: string, actorUserId: string) {
    const tx = currentTx();
    const r = await tx.execute<{ ticket_id: string }>(sql`
      UPDATE tickets
         SET work_status = 'open',
             work_outcome = NULL,
             work_closed_at = NULL,
             work_closed_by = NULL,
             work_closed_via = NULL,
             work_closed_line_user_id = NULL,
             work_closed_message_id = NULL,
             updated_at = now()
       WHERE ticket_id = ${ticketId}::uuid AND work_status = 'closed'
      RETURNING ticket_id::text
    `);
    if (r.rows.length === 0) throw new NotFoundException(msg("srv.work.notClosed"));
    this.logger.log(`work reopen · ticket=${ticketId} by=${actorUserId}`);
    return { ticketId, workStatus: "open" };
  }

  /**
   * 當責人自己結束手上的任務 · docs/modules/task-close-by-assignee.md M1
   *
   * 跟 `close()` 的差別只有兩點，但兩點都是安全性質的：
   *   ① outcome 只收「完成／不用做了」（OQ-TCA-8）
   *   ② **只能結束自己的**（F-2 · P0）
   *
   * ⚠️⚠️ 為什麼不共用 `close()` 再加個 if：
   * `close()` 是**主管代結案**的路徑，它刻意允許結束別人的票（doc 開頭那段註解）。
   * 把「是不是本人」做成參數，總有一天會有人傳錯而且不會有任何跡象。
   * 兩條路的授權模型不同，就分兩支。
   */
  async closeByAssignee(ticketId: string, outcome: string, actorUserId: string) {
    if (!ASSIGNEE_OUTCOMES.includes(outcome as WorkOutcome)) {
      throw new BadRequestException(msg("srv.work.outcomeNotAllowed"));
    }
    const tx = currentTx();
    const r = await tx.execute<{ ticket_id: string }>(sql`
      UPDATE tickets
         SET work_status = 'closed',
             work_outcome = ${outcome},
             work_closed_at = now(),
             work_closed_by = ${actorUserId}::uuid,
             work_closed_via = 'web',
             updated_at = now()
       WHERE ticket_id = ${ticketId}::uuid
         AND work_status = 'open'
         -- ⚠️⚠️ F-2（P0）· 這一行是唯一擋住「改掉網址裡的 ticketId 去關別人任務」的東西。
         --    RLS 只擋跨租戶，**擋不住同租戶跨人**。
         --    private-completion.service.ts:191 已經踩過一模一樣的形狀（postback 的 data 由 client 送回來）。
         AND assignee_user_id = ${actorUserId}::uuid
      RETURNING ticket_id::text
    `);
    // ⚠️ 「不是你的」和「已經結束了」**故意回同一句**。
    //    分開講就成了存在性探測器：換 ticketId 試，訊息不同就知道那張票存不存在、是不是別人的。
    //    同一個理由寫在 private-completion.service.ts:197。
    if (r.rows.length === 0) throw new NotFoundException(msg("srv.work.notYoursOrClosed"));
    this.logger.log(`work close(self) · ticket=${ticketId} outcome=${outcome} by=${actorUserId}`);
    return { ticketId, workStatus: "closed", workOutcome: outcome };
  }

  /**
   * 當責人還原自己剛才標錯的（OQ-TCA-4）。
   *
   * ⚠️ 條件比 `reopen()` 嚴：除了要是自己的票，**還要是自己關的**。
   * 主管代為結案的不讓員工翻掉 —— 那是主管的決定，要改請找主管。
   */
  async reopenByAssignee(ticketId: string, actorUserId: string) {
    const tx = currentTx();
    const r = await tx.execute<{ ticket_id: string }>(sql`
      UPDATE tickets
         SET work_status = 'open',
             work_outcome = NULL,
             work_closed_at = NULL,
             work_closed_by = NULL,
             work_closed_via = NULL,
             work_closed_line_user_id = NULL,
             work_closed_message_id = NULL,
             updated_at = now()
       WHERE ticket_id = ${ticketId}::uuid
         AND work_status = 'closed'
         AND assignee_user_id = ${actorUserId}::uuid
         AND work_closed_by = ${actorUserId}::uuid
      RETURNING ticket_id::text
    `);
    if (r.rows.length === 0) throw new NotFoundException(msg("srv.work.notYoursToReopen"));
    this.logger.log(`work reopen(self) · ticket=${ticketId} by=${actorUserId}`);
    return { ticketId, workStatus: "open" };
  }

  /** 回報進度 · 低承諾動作（§2.1）· 任務留在進行中 */
  async report(ticketId: string, note: string, actorUserId: string) {
    const text = note.trim();
    if (!text) throw new BadRequestException(msg("srv.work.needNote"));
    const tx = currentTx();
    const r = await tx.execute<{ ticket_id: string }>(sql`
      UPDATE tickets
         SET work_last_report_at = now(),
             work_last_report_note = ${text.slice(0, 1000)},
             updated_at = now()
       WHERE ticket_id = ${ticketId}::uuid AND work_status = 'open'
      RETURNING ticket_id::text
    `);
    if (r.rows.length === 0) throw new NotFoundException(msg("srv.work.gone"));
    this.logger.log(`work report · ticket=${ticketId} by=${actorUserId}`);
    return { ticketId };
  }
}
