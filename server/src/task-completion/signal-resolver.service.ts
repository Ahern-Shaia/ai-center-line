import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { withTenant } from "../db/client.js";

/**
 * 完成訊號的對應段（M3b）· docs/modules/task-completion-tracking.md §2.2 / §2.6
 *
 * group_batch 跑完之後回掃還沒消化的訊號：
 *   對得上任務        → 關掉它
 *   對不上但是完成語意 → **回頭補建任務並直接標完成**
 *
 * ⚠️ 為什麼要補建而不是丟掉：
 * prod 實測材料化涵蓋率只有 11%，引用回覆指向的訊息 89% 根本不是任務 ——
 * 三則真正的完成回覆，原訊息**全部**沒被材料化。
 * 若要求「原訊息必須已經是任務」，這個功能一則都接不住。
 *
 * 反過來想就通了：**有人願意引用回覆說「已完成」，那則訊息就是任務**。
 * 這是人工標註，比 AI 分類可靠得多。
 */
@Injectable()
export class SignalResolverService {
  private readonly logger = new Logger(SignalResolverService.name);

  /**
   * 回掃某租戶未消化的訊號。
   * @param groupId 限縮到剛跑完的那個群 · 不給則掃該租戶全部
   */
  async resolvePending(tenantId: string, groupId?: string): Promise<{
    closed: number; created: number; noMatch: number; asked: number; ambiguous: number; notAssignee: number;
  }> {
    return withTenant({ tenantId, role: "tenant_admin", departmentId: null, userId: null }, async (tx) => {
      const pending = await tx.execute<{
        signal_id: string; quoted_message_id: string; intent: string;
        replier_line_user_id: string; note: string | null; group_id: string;
      }>(sql`
        SELECT signal_id::text, quoted_message_id, intent, replier_line_user_id, note, group_id
          FROM pending_completion_signal
         WHERE tenant_id = ${tenantId}::uuid
           AND resolved_at IS NULL
           ${groupId ? sql`AND group_id = ${groupId}` : sql``}
         ORDER BY received_at
      `);

      let closed = 0, progressLogged = 0, created = 0, noMatch = 0, asked = 0, ambiguous = 0, notAssignee = 0;

      for (const sig of pending.rows) {
        // 問過但還沒回答的先留著 —— 人可能等一下才按
        if (sig.intent === "asked") { asked++; continue; }

        const isDone = sig.intent === "completion" || sig.intent === "answered_done";

        // ⚠️ 刻意**不加 LIMIT 1**。原本是 `ORDER BY created_at DESC LIMIT 1`：
        // 同一段對話若被抽成兩筆記錄（source_message_ids 重疊），就會**靜默關掉比較新的那一張**，
        // 而它發生的樣子跟正常關閉一模一樣 —— 不會有人發現關錯了。
        // prod 查過現況是 1:1（71 則來源訊息無一對到兩張），但那是資料剛好，不是機制擋著。
        const hit = await tx.execute<{
          ticket_id: string; work_status: string; assignee_user_id: string | null;
        }>(sql`
          SELECT ticket_id::text, work_status, assignee_user_id::text FROM tickets
           WHERE tenant_id = ${tenantId}::uuid
             AND source_message_ids @> ARRAY[${sig.quoted_message_id}]::text[]
           ORDER BY created_at DESC
        `);

        // 對到多張 → 我們無從得知他指的是哪一件。不動任何狀態，留給後台的未接住清單。
        // （私訊路徑有 postback 按鈕可以問他；群組路徑問了會在所有人面前洗版，不划算。）
        if (hit.rows.length > 1) {
          this.logger.warn(
            `[signal] 一則訊息對到 ${hit.rows.length} 張任務 · 不自動處理 · signal=${sig.signal_id}`,
          );
          await this.markResolved(tx, sig.signal_id, null, "ambiguous");
          ambiguous++;
          continue;
        }
        const ticket = hit.rows[0];

        if (ticket) {
          if (!isDone) {
            // 進度回報：記一筆，任務留著（這正是「回報進度」那顆低承諾按鈕的效果）
            await tx.execute(sql`
              UPDATE tickets
                 SET work_last_report_at = now(), work_last_report_note = ${sig.note}, updated_at = now()
               WHERE ticket_id = ${ticket.ticket_id}::uuid AND work_status = 'open'
            `);
            // ⚠️ 這裡**不是** closed —— 任務還開著，只是多了一筆進度。
            //    原本標成 closed_ticket，prod 上 2 筆「已關閉」全都是這種，
            //    零筆真的關掉任務。標籤講的事要跟實際相符（同 F-26）。
            await this.markResolved(tx, sig.signal_id, ticket.ticket_id, "progress_logged");
            progressLogged++;
            continue;
          }
          // 已經被結掉就不要再蓋一次（人可能已經在網頁上補登過）
          if (ticket.work_status === "closed") {
            await this.markResolved(tx, sig.signal_id, ticket.ticket_id, "superseded");
            continue;
          }

          // ⚠️ 這張票有當責人的話，只有他能結掉它。
          //
          // 原本這裡的條件只有 ticket_id —— 群裡任何人引用一則任務訊息說「已完成」，
          // 那張票就關了，即使它是別人的。私訊那條路有 assignee_user_id 把關，這條沒有。
          //
          // ⚠️ 但**不可以**一律要求「回報者＝當責人」：prod 45 張裡 38 張根本沒有當責人，
          //    目前 10 筆待處理訊號指到的票全部是這種。一律檢查等於讓它們永遠關不掉。
          //    沒有當責人時維持現狀（誰回報都算），那正是這個功能主要在接的東西。
          if (ticket.assignee_user_id) {
            const who = await tx.execute<{ user_id: string }>(sql`
              SELECT user_id::text FROM user_line_binding
               WHERE line_user_id = ${sig.replier_line_user_id} AND status = 'active' LIMIT 1`);
            const replierUserId = who.rows[0]?.user_id ?? null;
            if (replierUserId !== ticket.assignee_user_id) {
              // 不關票，但把它記成一筆進度 —— 別人講的「他做完了」是有價值的資訊，
              // 只是不足以代替當責人自己的回報。
              await tx.execute(sql`
                UPDATE tickets
                   SET work_last_report_at = now(), work_last_report_note = ${sig.note}, updated_at = now()
                 WHERE ticket_id = ${ticket.ticket_id}::uuid AND work_status = 'open'`);
              await this.markResolved(tx, sig.signal_id, ticket.ticket_id, "not_assignee");
              notAssignee++;
              continue;
            }
          }
          await tx.execute(sql`
            UPDATE tickets
               SET work_status = 'closed', work_outcome = '完成', work_closed_at = now(),
                   work_closed_via = 'line_reply',
                   work_closed_line_user_id = ${sig.replier_line_user_id},
                   work_closed_message_id = ${sig.quoted_message_id},
                   work_note = ${sig.note}, updated_at = now()
             WHERE ticket_id = ${ticket.ticket_id}::uuid
          `);
          await this.markResolved(tx, sig.signal_id, ticket.ticket_id, "closed_ticket");
          closed++;
          continue;
        }

        // 對不上任務 —— 只有完成語意才補建。進度回報沒有任務可掛就算了，
        // 否則群裡每一句「零件週四到」都會長出一張已完成的卡片。
        if (!isDone) {
          await this.markResolved(tx, sig.signal_id, null, "no_match");
          noMatch++;
          continue;
        }

        const newId = await this.createFromSignal(tx, tenantId, sig);
        if (newId) {
          await this.markResolved(tx, sig.signal_id, newId, "created_ticket");
          created++;
        } else {
          await this.markResolved(tx, sig.signal_id, null, "no_match");
          noMatch++;
        }
      }

      if (pending.rows.length > 0) {
        this.logger.log(
          `resolvePending · tenant=${tenantId}${groupId ? ` group=${groupId}` : ""} · `
          + `closed=${closed} progress=${progressLogged} created=${created} `
          + `noMatch=${noMatch} asked=${asked} ambiguous=${ambiguous} notAssignee=${notAssignee}`,
        );
      }
      return { closed, progressLogged, created, noMatch, asked, ambiguous, notAssignee };
    });
  }

  /**
   * 完成回覆落在「不是任務」的訊息上 → 回頭補建並直接標完成。
   *
   * 這張卡片的 confirm_status 給「存查」而不是「待簽核」：
   * 事情已經做完了，再讓主管簽核一次沒有意義，只是多一個要清的佇列。
   */
  private async createFromSignal(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    tenantId: string,
    sig: { quoted_message_id: string; replier_line_user_id: string; note: string | null; group_id: string },
  ): Promise<string | null> {
    const src = await tx.execute<{
      text_content: string | null; department_id: string | null;
      message_type: string; sender: string | null; sent_at_label: string;
    }>(sql`
      SELECT m.text_content, lg.department_id::text, m.message_type,
             mem.display_name AS sender,
             to_char(m.sent_at AT TIME ZONE 'Asia/Taipei', 'MM/DD HH24:MI') AS sent_at_label
        FROM line_message m
        LEFT JOIN line_group lg ON lg.group_id = m.group_id
        LEFT JOIN line_member mem
               ON mem.group_id = m.group_id AND mem.user_id = m.sender_line_id
       WHERE m.message_id = ${sig.quoted_message_id} AND m.tenant_id = ${tenantId}::uuid
       LIMIT 1
    `);
    const row = src.rows[0];
    // 沒有部門就掛不上（tickets.department_id NOT NULL）· 留成 no_match 讓後台看得到
    if (!row?.department_id) return null;

    const summary = (row.text_content ?? "").trim().slice(0, 500)
      || mediaSummary(row.message_type, row.sender, row.sent_at_label);
    const ins = await tx.execute<{ ticket_id: string }>(sql`
      INSERT INTO tickets (
        tenant_id, department_id, summary, status, confidence, confirm_status,
        source_message_ids,
        work_status, work_outcome, work_closed_at, work_closed_via,
        work_closed_line_user_id, work_closed_message_id, work_note
      ) VALUES (
        ${tenantId}::uuid, ${row.department_id}::uuid, ${summary}, 'resolved', 'high', '存查',
        ARRAY[${sig.quoted_message_id}]::text[],
        'closed', '完成', now(), 'line_reply',
        ${sig.replier_line_user_id}, ${sig.quoted_message_id}, ${sig.note}
      )
      RETURNING ticket_id::text
    `);
    return ins.rows[0]?.ticket_id ?? null;
  }

  private async markResolved(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    signalId: string,
    ticketId: string | null,
    resolution: "closed_ticket" | "progress_logged" | "created_ticket" | "no_match" | "superseded" | "ambiguous" | "not_assignee",
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE pending_completion_signal
         SET resolved_at = now(), resolved_ticket_id = ${ticketId}::uuid, resolution = ${resolution}
       WHERE signal_id = ${signalId}::uuid
    `);
  }
}

/**
 * 被引用的原訊息沒有文字時（照片／影片／檔案）的摘要。
 *
 * ⚠️ 原本一律落到「（來自 LINE 完成回報）」這句通用字串。
 * prod 上線後第一筆真實補建就是這種：11:06 有人傳了一張照片，
 * 11:20 有人引用它回「好了」—— 任務建出來了、照片也存著、點開看得到圖，
 * 但**看板上那一行完全不知道發生了什麼事**。
 * 資料沒丟，可是主管掃過去等於沒看到，跟沒接住差不多。
 *
 * 帶上型別、是誰、什麼時候，主管至少判斷得出要不要點開。
 */
function mediaSummary(
  messageType: string, sender: string | null, sentAtLabel: string,
): string {
  const kind = MEDIA_LABEL[messageType] ?? "訊息";
  const who = sender?.trim() ? `${sender.trim()} ` : "";
  return `${who}${sentAtLabel} 的${kind}（LINE 回報完成 · 點開看原始內容）`;
}

const MEDIA_LABEL: Record<string, string> = {
  image: "照片", video: "影片", audio: "語音", file: "檔案",
  sticker: "貼圖", location: "位置",
};
