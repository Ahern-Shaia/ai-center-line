import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { LineApiClient } from "../line-ingest/line-api.client.js";
import { TaskConfigService } from "../task-config/task-config.service.js";

/** 沒通知成功時，為什麼 —— 一定要講出來，不可以靜默（FMEA A-1 · P0）*/
export type NotifySkipReason =
  /** 這個人沒有綁定 LINE（或根本沒有系統帳號）*/
  | "no_binding"
  /** 該租戶沒有可用的 bot */
  | "no_bot"
  /** 客戶把這個通知關掉了 */
  | "disabled"
  /** 已經通知過同一個人，不重複打擾 */
  | "already_notified"
  /** LINE 回錯（額度、token 失效…）*/
  | "push_failed";

export interface NotifyResult {
  notified: boolean;
  skipReason: NotifySkipReason | null;
}

/**
 * 指派後私訊當事人 · docs/modules/task-assign-notify.md
 *
 * ⚠️ 這是本產品**第一個同步的主動推播**。界線（doc §2.2）：
 *   可推 —— 有人對他做了決定（指派給你／取消你的任務）
 *   不可推 —— 狀態廣播、系統定時提醒
 * 加新的推播場景之前先回去讀那一節，不要因為「技術上做得到」就接上。
 *
 * ⚠️ 走**該租戶自己綁的 bot**，token 由 ticket 的 tenant_id 查出來，
 *    不可以從 request 帶（FMEA A-7 · 跨租戶外洩）。
 */
@Injectable()
export class AssignNotifyService {
  private readonly logger = new Logger(AssignNotifyService.name);

  constructor(
    private readonly lineApi: LineApiClient,
    private readonly taskConfig: TaskConfigService,
  ) {}

  /**
   * 指派給某人 → 私訊他。
   * @param tx 已在租戶上下文的交易（呼叫端負責）
   */
  async onAssigned(tx: Db, args: {
    ticketId: string; assigneeUserId: string; summary: string; actorName: string;
  }): Promise<NotifyResult> {
    const cfg = await this.taskConfig.forCurrentTenant(tx);
    if (!cfg.assignNotify) return { notified: false, skipReason: "disabled" };

    // 已經通知過同一個人就不再推（A-4 · 主管改來改去不該變成連續私訊）
    const prev = await tx.execute<{ notified_user: string | null }>(sql`
      SELECT assign_notified_user_id::text AS notified_user
        FROM tickets WHERE ticket_id = ${args.ticketId}::uuid`);
    if (prev.rows[0]?.notified_user === args.assigneeUserId) {
      return { notified: false, skipReason: "already_notified" };
    }

    const target = await this.lookupTarget(tx, args.assigneeUserId);
    if (!target) return { notified: false, skipReason: "no_binding" };

    // ⚠️ 只帶摘要不帶原始對話（A-5）—— 任務可能來自他不在的群組。
    // ⚠️ 不寫「請於 X 日前完成」—— due_at 在 prod 是 100% null，寫了就是編一個不存在的期限。
    // ⚠️ 不附「查看任務」連結（OQ-TAN-7）—— 當事人多半沒有系統帳號，點進去要登入＝死路。
    const text = `📋 ${args.actorName} 指派了一件事給你\n\n${args.summary}\n\n`
      + "做完後在群組裡引用相關訊息回一句「好了」即可";

    const ok = await this.push(target, text, args.ticketId);
    if (!ok) return { notified: false, skipReason: "push_failed" };

    await tx.execute(sql`
      UPDATE tickets SET assign_notified_at = now(), assign_notified_user_id = ${args.assigneeUserId}::uuid
       WHERE ticket_id = ${args.ticketId}::uuid`);
    return { notified: true, skipReason: null };
  }

  /**
   * 取消指派／改派他人 → 只通知**原本推過**的那個人（A-6）。
   * 沒推過就不必特地跟他說「這件事不用做了」—— 他根本不知道有這件事。
   */
  async onUnassigned(tx: Db, args: { ticketId: string; summary: string }): Promise<void> {
    const prev = await tx.execute<{ notified_user: string | null }>(sql`
      SELECT assign_notified_user_id::text AS notified_user
        FROM tickets WHERE ticket_id = ${args.ticketId}::uuid`);
    const previous = prev.rows[0]?.notified_user;
    if (!previous) return;

    const cfg = await this.taskConfig.forCurrentTenant(tx);
    if (cfg.assignNotify) {
      const target = await this.lookupTarget(tx, previous);
      if (target) {
        await this.push(target, `這件事已改由他人處理，你不用再跟：\n\n${args.summary}`, args.ticketId);
      }
    }
    await tx.execute(sql`
      UPDATE tickets SET assign_notified_at = NULL, assign_notified_user_id = NULL
       WHERE ticket_id = ${args.ticketId}::uuid`);
  }

  /**
   * 找這個人的 LINE 身分與他所屬租戶的 bot token。
   *
   * ⚠️ **必須用呼叫端的租戶交易，不可以用 `withSystemTx`。**
   * 第一版寫成 withSystemTx，結果**每一次查詢都回空**：
   * `user_line_binding` 的 policy 裡有一段 `EXISTS (SELECT 1 FROM users ...)`，
   * 而 `users` 的逃生門只有 `aiproot_admin` 與 `auth_lookup` —— **沒有 `system`**。
   * 於是子查詢在 system 上下文回 0 列 → EXISTS 為 false → 綁定看不見。
   *
   * 而它失敗的樣子是「這個人沒綁定 LINE」—— 跟真的沒綁完全一樣，
   * 主管會看到「對方未綁定」然後自己去講一聲，永遠不會有人發現這是 bug。
   * （本專案第 11 次踩 RLS 靜默回 0）
   */
  private async lookupTarget(tx: Db, userId: string): Promise<{ token: string; lineUserId: string } | null> {
    const key = process.env.LINE_CONFIG_ENC_KEY ?? "test-only-line-enc-key-32chars---";
    const r = await tx.execute<{ token: string; line_user_id: string }>(sql`
      SELECT pgp_sym_decrypt(lb.channel_access_token_enc, ${key}) AS token,
             b.line_user_id
        FROM user_line_binding b
        JOIN line_bot lb ON lb.bot_id = b.bot_id
       WHERE b.user_id = ${userId}::uuid AND b.status = 'active'
       LIMIT 1`);
    const row = r.rows[0];
    return row?.token && row.line_user_id ? { token: row.token, lineUserId: row.line_user_id } : null;
  }

  /**
   * ⚠️ 推播失敗**不可以**讓指派失敗（A-8）。
   * 指派是主管的決定，已經寫進 DB；通知只是把它送達。
   * 送不到就回 false，由呼叫端在畫面上說出來。
   */
  private async push(
    target: { token: string; lineUserId: string }, text: string, ticketId: string,
  ): Promise<boolean> {
    try {
      await this.lineApi.pushMessage(target.token, target.lineUserId, [{ type: "text", text }]);
      return true;
    } catch (err) {
      // A-3：失敗要看得到，不可只吞
      this.logger.warn(`[assign-notify] push 失敗 · ticket=${ticketId} · ${(err as Error).message}`);
      return false;
    }
  }
}
