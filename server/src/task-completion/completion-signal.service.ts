import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { classifyIntent, type CompletionIntent } from "./completion-intent.js";

/**
 * 完成訊號的即時段（M3a）· docs/modules/task-completion-tracking.md §2.6
 *
 * ⚠️ 這裡**刻意不去找任務**。
 * 完成回覆是即時進來的，任務是每天批次才產生的 —— prod 真實案例是
 * 07/27 21:28 指派、21:39 回「已設定」，但分析要到 07/28 18:00 才跑到。
 * 訊號比任務早 21 小時，當下去找一定找不到，訊號就掉在地上了。
 *
 * 所以：先落地（本檔）、後對應（signal-resolver，批次跑完才回掃）。
 */
@Injectable()
export class CompletionSignalService {
  private readonly logger = new Logger(CompletionSignalService.name);

  /**
   * 收下一則引用回覆。
   *
   * @returns 要回給使用者的話 · null = 不回（催問／看不出名堂的進度都不回，
   *          在群裡多嘴只會變成噪音）
   */
  async capture(tx: Db, args: {
    tenantId: string;
    groupId: string;
    replyMessageId: string;
    quotedMessageId: string;
    replierLineUserId: string;
    replierDisplayName: string | null;
    text: string;
  }): Promise<{ intent: CompletionIntent; reply: string | null }> {
    // 被引用那則是誰發的 —— 結構過濾要用（自己引自己＝催問）
    const quoted = await tx.execute<{ sender_line_id: string | null }>(sql`
      SELECT sender_line_id FROM line_message
       WHERE message_id = ${args.quotedMessageId} AND tenant_id = ${args.tenantId}::uuid
       LIMIT 1
    `);

    const intent = classifyIntent({
      text: args.text,
      replierLineUserId: args.replierLineUserId,
      quotedSenderLineUserId: quoted.rows[0]?.sender_line_id ?? null,
    });

    // 催問不是狀態回報 —— 不落訊號、不回話
    if (intent === "follow_up") return { intent, reply: null };

    await tx.execute(sql`
      INSERT INTO pending_completion_signal
        (tenant_id, group_id, reply_message_id, quoted_message_id,
         replier_line_user_id, replier_display_name, intent, note)
      VALUES
        (${args.tenantId}::uuid, ${args.groupId}, ${args.replyMessageId}, ${args.quotedMessageId},
         ${args.replierLineUserId}, ${args.replierDisplayName},
         ${intent === "ask" ? "asked" : intent}, ${truncate(args.text, 1000)})
      ON CONFLICT (reply_message_id) DO NOTHING
    `);

    return { intent, reply: replyFor(intent) };
  }
}

/**
 * ⚠️ 只在「接得住」時回話。
 *
 * 不回的情況要保持安靜 —— 在群裡說「我找不到對應的任務」只會製造噪音，
 * 而且把系統的失敗攤在所有人面前。接不到的統一進後台的未接住清單。
 *
 * 另外措辭一律「尚未確認完成」不用「未完成」（F-26）：
 * 後者說的是工作狀態，人做完但還沒回報時它是假的。
 */
function replyFor(intent: CompletionIntent): string | null {
  switch (intent) {
    case "completion":
      // ⚠️ 這裡**不可以**寫「回一句『更正』即可」（舊版是這樣寫的）——
      // 群組沒有實作撤銷：這條路的關閉是在當天批次才發生的，
      // 而群組分支只在「有引用回覆」時才會進來，接不到一句單獨的「更正」。
      // 承諾一個不存在的動作，比不承諾更糟（他會以為已經救回來了）。
      // 私訊那條路的撤銷是真的（PrivateCompletionService.undoLastClose）。
      return "✓ 已收到完成回報";
    case "ask":
      // 當下任務還不存在，所以問「你剛回覆的這件」而不是問某張任務
      return "收到。你剛回覆的這件算完成了嗎？\n完成的話回「完成」，還沒的話不用理我。";
    case "progress":
      // 進度不回話 —— 每則進度都回等於每天洗版
      return null;
    default:
      return null;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
