import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { withTenant } from "../db/client.js";
import { classifyIntent } from "./completion-intent.js";

/**
 * 私訊裡的完成回報 · docs/modules/task-assign-notify.md §2.6
 *
 * ⚠️ 為什麼要有這支：
 * 完成訊號原本**只掛在群組分支**（line-webhook.service.ts:210）。
 * 但指派通知是**私訊**推給當事人的，而人收到私訊的自然反應是在私訊回。
 * 他回「好了」→ bot 答「✓ 已記錄」→ 任務原封不動 —— 他以為回報過了。
 * 那不是他的錯，是我們的文案把他導到一條沒接線的路上。
 *
 * ⚠️ 一對一的關鍵優勢：**「是誰」永遠確定**，缺的只有「哪一張」。
 * 所以這裡的規則是「不猜」：
 *   他回覆我們那則通知 → 精準對到（快路徑，0 個判斷）
 *   手上只有一張開著的 → 就是它（0 個判斷）
 *   手上有多張        → **問他**，出按鈕讓他點（1 個 tap，不是猜）
 *   手上沒有          → 不接手，讓原本的「✓ 已記錄」照常回
 */
@Injectable()
export class PrivateCompletionService {
  private readonly logger = new Logger(PrivateCompletionService.name);

  /**
   * @returns 要回的 LINE 訊息 · null = 這則不歸我管，讓呼叫端走原本的 ack
   *
   * ⚠️ 自己開 `withTenant`，**不可以**吃 webhook 那個 tx ——
   * webhook 整段跑在 `withSystemTx` 裡，而 `tickets` 的 RLS 沒有 system 逃生門，
   * 在那裡查會靜默回 0 筆（＝看起來就像「他手上沒有任務」，永遠不會有人回報這個 bug）。
   */
  async handleText(args: {
    tenantId: string;
    userId: string;                     // 已綁定的系統帳號
    lineUserId: string;
    text: string;
    messageId: string;
    quotedMessageId: string | null;
  }): Promise<unknown[] | null> {
    // ⚠️ 更正要在 classifyIntent 之前判 —— 「更正」不是完成語意，
    //    走到下面會被判成 progress 然後不接手，掉回通用的「✓ 已記錄」。
    //    我們在確認訊息裡承諾了這個動作，它就必須真的會動。
    if (CORRECTION.test(args.text.trim())) return this.undoLastClose(args);

    // 私訊沒有「自己引用自己＝催問」這種結構（他是在回 bot），所以 quotedSender 給 null
    const intent = classifyIntent({
      text: args.text,
      replierLineUserId: args.lineUserId,
      quotedSenderLineUserId: null,
    });
    // 只接高把握的完成語意。進度／疑問／模糊一律不接手 ——
    // 誤關一張沒做完的任務，比漏接一次貴得多（同 completion-intent.ts 的取捨）。
    if (intent !== "completion") return null;

    return withTenant(
      { tenantId: args.tenantId, role: "tenant_admin", departmentId: null, userId: args.userId },
      async (tx) => {
        // 快路徑：他直接「回覆」我們推的那則指派通知
        let quotedMissed = false;
        if (args.quotedMessageId) {
          const exact = await tx.execute<{ ticket_id: string; summary: string | null }>(sql`
            SELECT ticket_id::text, summary FROM tickets
             WHERE assign_notify_message_id = ${args.quotedMessageId}
               AND assignee_user_id = ${args.userId}::uuid
               AND work_status = 'open'
             LIMIT 1`);
          const t = exact.rows[0];
          if (t) {
            await this.close(tx, t.ticket_id, args);
            return [{ type: "text", text: confirmText(t.summary) }];
          }
          quotedMissed = true;
        }

        const open = await tx.execute<{ ticket_id: string; summary: string | null }>(sql`
          SELECT ticket_id::text, summary FROM tickets
           WHERE assignee_user_id = ${args.userId}::uuid AND work_status = 'open'
           ORDER BY assigned_at DESC NULLS LAST, created_at DESC`);

        // 他手上根本沒有指派任務 —— 這句話不是回報，別接手
        if (open.rows.length === 0) return null;

        // ⚠️⚠️ 引用了但對不到 → **不可以**掉到下面「只有一張就是它」。
        //
        // 引用是明確的意圖表達：「我說的是這一件」。對不到最常見的原因是
        // 主管把它改派給別人了（改派時 assign_notify_message_id 會被覆蓋成新那位的），
        // 而他的聊天室裡還留著我們當初推給他的那則。
        //
        // 舊版在這裡直接掉下去，於是：他指甲、系統關掉乙，**雙方都以為成功**。
        // 實測重現過（改派後他手上剛好還有另一張，那張就被關掉了）。
        if (quotedMissed) {
          this.logger.log(
            `[private-completion] 引用對不到 · user=${args.userId.slice(0, 8)} · quoted=${args.quotedMessageId}`,
          );
          return [buildPicker(open.rows, "missed")];
        }

        if (open.rows.length === 1) {
          await this.close(tx, open.rows[0].ticket_id, args);
          return [{ type: "text", text: confirmText(open.rows[0].summary) }];
        }

        // 多張 → 問。**不可以**挑最新的那張湊合，那正是使用者擔心的誤判。
        this.logger.log(
          `[private-completion] 多張待選 · user=${args.userId.slice(0, 8)} · n=${open.rows.length}`,
        );
        return [buildPicker(open.rows, "multi")];
      },
    );
  }

  /**
   * 「更正」—— 把他上一次回報完成的那張改回進行中。
   *
   * ⚠️ 這是**最後一道防線**，不是錦上添花。
   * 事前判斷不可能 100% 正確：他手上只有一張、又沒有引用、而他講的其實是別的事，
   * 這種情況沒有任何辦法在當下分辨（除非每次都問，那違反「判斷 0 次」的目標）。
   * 所以「關錯了能一句話救回來」才是真正的保證。
   *
   * ⚠️ 舊版三處確認文案都寫「回一句『更正』即可」，但**完全沒有實作** ——
   * 他回「更正」會被判成 progress、掉到通用的「✓ 已記錄」，
   * 於是他以為更正生效了。承諾了就要做到，不然比不承諾更糟。
   */
  private async undoLastClose(args: {
    tenantId: string; userId: string; lineUserId: string;
  }): Promise<unknown[]> {
    return withTenant(
      { tenantId: args.tenantId, role: "tenant_admin", departmentId: null, userId: args.userId },
      async (tx) => {
        // 用 LINE 身分比對而不是 user_id：群組那條路關掉的票 work_closed_by 是空的，
        // 只有 work_closed_line_user_id 一定有值。兩條路關的都救得回來。
        const r = await tx.execute<{ ticket_id: string; summary: string | null }>(sql`
          SELECT ticket_id::text, summary FROM tickets
           WHERE work_status = 'closed'
             AND work_closed_via = 'line_reply'
             AND (work_closed_by = ${args.userId}::uuid
                  OR work_closed_line_user_id = ${args.lineUserId})
             AND work_closed_at > now() - interval '24 hours'
           ORDER BY work_closed_at DESC LIMIT 1`);
        const t = r.rows[0];
        if (!t) {
          return [{ type: "text", text: "最近 24 小時內沒有找到由你回報完成的任務，沒有東西需要更正。" }];
        }

        await tx.execute(sql`
          UPDATE tickets
             SET work_status = 'open',
                 work_outcome = NULL, work_closed_at = NULL, work_closed_via = NULL,
                 work_closed_by = NULL, work_closed_line_user_id = NULL, work_closed_message_id = NULL,
                 -- 進度欄留痕：不要讓「被更正過」這件事消失得無影無蹤
                 work_last_report_at = now(),
                 work_last_report_note = '（當事人回報「更正」· 已從完成改回進行中）',
                 updated_at = now()
           WHERE ticket_id = ${t.ticket_id}::uuid`);
        this.logger.log(`[private-completion] 更正 · 重開 ticket=${t.ticket_id}`);

        return [{ type: "text", text: `已改回進行中：\n\n${truncate((t.summary ?? "").trim(), 100)}` }];
      },
    );
  }

  /**
   * 他點了「是哪一件」的按鈕。
   * @param data postback 的 data · 格式 `done:<ticketId>`
   */
  async handlePostback(args: {
    tenantId: string;
    userId: string;
    lineUserId: string;
    messageId: string;                  // postback 沒有 messageId · 傳 webhookEventId 或空字串
    data: string;
  }): Promise<unknown[] | null> {
    const ticketId = args.data.startsWith("done:") ? args.data.slice(5) : null;
    if (!ticketId || !UUID.test(ticketId)) return null;

    return withTenant(
      { tenantId: args.tenantId, role: "tenant_admin", departmentId: null, userId: args.userId },
      async (tx) => {
        const r = await tx.execute<{ summary: string | null; work_status: string; mine: boolean }>(sql`
          SELECT summary, work_status,
                 (assignee_user_id = ${args.userId}::uuid) AS mine
            FROM tickets WHERE ticket_id = ${ticketId}::uuid LIMIT 1`);
        const t = r.rows[0];

        // ⚠️ 一定要擋 `mine`：postback 的 data 由 client 送回來，改掉裡面的 ticketId
        //    就能關掉同租戶**別人**的任務 —— RLS 只擋跨租戶，擋不住這個。
        //
        // 三種接不了的情況分開講，因為它們對他的意義完全不同：
        //   已經關了 → 他點了兩次，或主管先在網頁補登了
        //   不是他的 → 他按到按鈕時已被改派（按鈕還留在聊天室裡）
        //   查無此票 → 偽造的 id。**不回「找不到」**，否則就成了存在性探測器。
        if (!t) return [{ type: "text", text: "這件事已經是完成狀態了，不用再回報一次。" }];
        if (!t.mine) return [{ type: "text", text: "這件事已改由他人處理，你不用再跟。" }];
        if (t.work_status !== "open") {
          return [{ type: "text", text: "這件事已經是完成狀態了，不用再回報一次。" }];
        }

        await this.close(tx, ticketId, args);
        return [{ type: "text", text: confirmText(t.summary) }];
      },
    );
  }

  private async close(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    ticketId: string,
    by: { userId: string; lineUserId: string; messageId: string; text?: string },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE tickets
         SET work_status = 'closed', work_outcome = '完成', work_closed_at = now(),
             work_closed_via = 'line_reply',
             work_closed_by = ${by.userId}::uuid,
             work_closed_line_user_id = ${by.lineUserId},
             work_closed_message_id = ${by.messageId || null},
             work_note = ${by.text ?? null},
             updated_at = now()
       WHERE ticket_id = ${ticketId}::uuid`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 「更正」的說法。
 *
 * ⚠️ **整句錨定**（`^...$`），不可以用「包含」比對：
 * 「客戶說地址弄錯了」這種正常的工作回報裡就含「弄錯了」，
 * 用包含比對會把它當成撤銷指令，回頭把一張已完成的任務打開。
 */
const CORRECTION = /^(更正|弄錯了?|搞錯了?|打錯了?|報錯了?|不是這件|不是這個|不是這一件)[。.!！~～]*$/;

/** 措辭一律「已收到完成回報」不寫「已完成」（F-26）· 我們收到的是回報，不是事實本身 */
function confirmText(summary: string | null): string {
  const s = (summary ?? "").trim();
  // 要把關掉的是哪一件講出來 —— 不然他無從發現我們對錯了
  return s
    ? `✓ 已收到完成回報\n\n${truncate(s, 100)}\n\n（若對錯了，回一句「更正」即可）`
    : "✓ 已收到完成回報\n（若對錯了，回一句「更正」即可）";
}

/**
 * 多張時的選單。
 *
 * 用 postback 按鈕而不是「回我編號」：編號要嘛得存狀態、要嘛在他回覆前有票被關掉就會錯位，
 * 而錯位的下場是**關掉另一件沒做完的事**。按鈕把 ticketId 直接帶回來，沒有這個縫。
 *
 * LINE buttons template 上限 4 個 action、label 20 字、text 160 字 —— 超過的部分另外講。
 */
function buildPicker(
  rows: Array<{ ticket_id: string; summary: string | null }>,
  reason: "multi" | "missed",
): unknown {
  const shown = rows.slice(0, 4);
  const rest = rows.length - shown.length;
  const list = shown.map((r, i) => `${MARK[i]} ${truncate(r.summary ?? "（無摘要）", 24)}`).join("\n");
  const tail = rest > 0 ? `\n（另有 ${rest} 件較早的，可到系統操作）` : "";
  // 對不到時要講出**為什麼**在問。只寫「是哪一件」的話，
  // 他會以為系統沒看到他的引用，而不會想到那件已經不是他的了。
  const lead = reason === "missed"
    ? `你回覆的那一件我對不到（可能已改由他人處理，或已經結案）。\n你手上還有 ${rows.length} 件在進行：`
    : `你手上有 ${rows.length} 件在進行，是哪一件做完了？`;

  return {
    type: "template",
    altText: "是哪一件做完了？",
    template: {
      type: "buttons",
      text: truncate(`${lead}\n\n${list}${tail}`, 160),
      actions: shown.map((r, i) => ({
        type: "postback",
        label: truncate(`${MARK[i]} ${(r.summary ?? "無摘要").trim()}`, 20),
        data: `done:${r.ticket_id}`,
        displayText: `${MARK[i]} 這件做完了`,
      })),
    },
  };
}

const MARK = ["①", "②", "③", "④"];

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
