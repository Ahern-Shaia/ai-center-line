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
    const previous = prev.rows[0]?.notified_user;
    if (previous === args.assigneeUserId) {
      return { notified: false, skipReason: "already_notified" };
    }

    // ⚠️ 改派他人時，**原本推過的那個人也要知道**（A-6 的另一半）。
    // 舊版只在「退回待認領」（assigneeUserId = null）時通知原本那位，
    // 改派 A→B 時 A 完全不知情 —— 他手機裡還留著我們推給他的通知，
    // 以為那件事還是他的，日後就會拿那則舊通知來回報完成。
    // （那正是「引用對不到」的主要來源，見 private-completion.service.ts F1）
    if (previous) await this.notifyTakenOver(tx, previous, args.summary, args.ticketId);

    const target = await this.lookupTarget(tx, args.assigneeUserId);
    if (!target) return { notified: false, skipReason: "no_binding" };

    // ⚠️ 只帶摘要不帶原始對話（A-5）—— 任務可能來自他不在的群組。
    // ⚠️ 不寫「請於 X 日前完成」。
    //    原因在 2026-09-01 變了，結論沒變：以前是 due_at 在 prod 100% null（寫了就是編一個期限）；
    //    現在材料化會寫 AI 抽到的預定日期，但那是**抽出來的**，不是主管訂的交期 ——
    //    把它寫成「請於 X 日前完成」等於用 AI 的推測去下指令。要寫得先有人訂交期的功能。
    // ⚠️ 不附「查看任務」連結（OQ-TAN-7）—— 當事人多半沒有系統帳號，點進去要登入＝死路。
    //
    // ⚠️ 不可以再寫「去群組裡引用訊息回覆」（第一版是這樣寫的）——
    // 完成訊號原本只掛在群組分支，而人收到私訊的自然反應是**在私訊回**，
    // 回了會得到「✓ 已記錄」然後任務不動 —— 他以為回報過了。
    // 現在回報收在私訊本身（private-completion.service.ts），文案就照著寫。
    const text = `📋 ${args.actorName} 指派了一件事給你\n\n${args.summary}\n\n`
      + "做完後回我一句「好了」就行";

    const sentId = await this.push(target, text, args.ticketId);
    if (sentId === false) return { notified: false, skipReason: "push_failed" };

    // sentId 為 null = LINE 沒回訊息 id，快路徑失效但功能還在（慢路徑會問他是哪一件）
    await tx.execute(sql`
      UPDATE tickets SET assign_notified_at = now(),
                         assign_notified_user_id  = ${args.assigneeUserId}::uuid,
                         assign_notify_message_id = ${sentId}
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
    if (cfg.assignNotify) await this.notifyTakenOver(tx, previous, args.summary, args.ticketId);

    await tx.execute(sql`
      UPDATE tickets SET assign_notified_at = NULL, assign_notified_user_id = NULL,
                         assign_notify_message_id = NULL
       WHERE ticket_id = ${args.ticketId}::uuid`);
  }

  /**
   * 知會其他人（⑤ 台灣福祉 2026-08-24 · OQ-TWH-5 裁定：只發個人私訊，不碰群組）。
   *
   * ⚠️⚠️ **文案必須跟指派通知明確區隔。**
   *    指派通知結尾是「做完後回我一句『好了』就行」—— 那句話對被知會的人是錯的，
   *    他不是當責人。而且 private-completion 是用 `assignee_user_id` 比對，
   *    他就算回「好了」也對不到這張任務（結構上安全，但文案不能誤導他去回）。
   *
   * ⚠️ 送不到不算失敗：逐一回報每個人的結果，讓主管知道誰沒收到 ——
   *    「已通知」但其實沒送到，主管會以為對方知道了（同 A-1 的判準）。
   */
  async notifyOthers(tx: Db, args: {
    ticketId: string; summary: string; actorName: string;
    assigneeName: string | null; userIds: string[];
  }): Promise<Array<{ userId: string; name: string | null; notified: boolean; reason: string | null }>> {
    const cfg = await this.taskConfig.forCurrentTenant(tx);
    const out: Array<{ userId: string; name: string | null; notified: boolean; reason: string | null }> = [];

    for (const userId of args.userIds) {
      const target = await this.lookupTarget(tx, userId);
      if (!cfg.assignNotify) { out.push({ userId, name: null, notified: false, reason: "disabled" }); continue; }
      if (!target) { out.push({ userId, name: null, notified: false, reason: "no_binding" }); continue; }

      const who = args.assigneeName ? `目前由 ${args.assigneeName} 負責` : "目前還沒指定負責人";
      const text = `👀 ${args.actorName} 讓你知道一件事\n\n${args.summary}\n\n${who}\n`
        + "（這則只是知會，不用回覆）";

      const nameRow = await tx.execute<{ display_name: string | null }>(sql`
        SELECT display_name FROM users WHERE user_id = ${userId}::uuid LIMIT 1`);
      const sent = await this.push(target, text, args.ticketId);
      out.push({
        userId, name: nameRow.rows[0]?.display_name ?? null,
        notified: sent !== false, reason: sent === false ? "push_failed" : null,
      });
    }
    return out;
  }

  /**
   * 跟原本被推播過的那個人說「這件事不用你跟了」。
   *
   * ⚠️ 送不到只記 log，不可以讓指派／改派失敗（同 A-8）——
   * 主管的決定已經寫進 DB，通知只是把它送達。
   */
  private async notifyTakenOver(
    tx: Db, previousUserId: string, summary: string, ticketId: string,
  ): Promise<void> {
    const target = await this.lookupTarget(tx, previousUserId);
    if (!target) return;
    await this.push(target, `這件事已改由他人處理，你不用再跟：\n\n${summary}`, ticketId);
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
   *
   * @returns `false` = 沒送出去 · `string` = 送出那則的 id · `null` = 送出了但 LINE 沒給 id
   */
  private async push(
    target: { token: string; lineUserId: string }, text: string, ticketId: string,
  ): Promise<string | null | false> {
    try {
      const r = await this.lineApi.pushMessage(target.token, target.lineUserId, [{ type: "text", text }]);
      return r.messageId;
    } catch (err) {
      // A-3：失敗要看得到，不可只吞
      this.logger.warn(`[assign-notify] push 失敗 · ticket=${ticketId} · ${(err as Error).message}`);
      return false;
    }
  }
}
