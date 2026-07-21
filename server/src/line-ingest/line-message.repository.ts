import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

/**
 * line_message repository · webhook 收訊落庫 · pipeline 讀 blob
 * message_id (LINE messageId) 為 PK · 天然冪等
 */
@Injectable()
export class LineMessageRepository {
  async insertOnEvent(tx: Db, args: {
    messageId: string;
    tenantId: string;
    botId: string;
    groupId: string;
    departmentId: string | null;
    senderLineId: string | null;
    messageType: string;
    textContent: string | null;
    stickerRef: Record<string, unknown> | null;
    sentAtMs: number;
    rawEvent: Record<string, unknown>;
  }): Promise<{ inserted: boolean }> {
    const sentAt = new Date(args.sentAtMs).toISOString();
    // ON CONFLICT DO NOTHING · LINE retry 冪等 (messageId 是 LINE 全域唯一)
    const res = await tx.execute<{ inserted: boolean }>(sql`
      INSERT INTO line_message (
        message_id, tenant_id, bot_id, group_id, department_id,
        sender_line_id, message_type, text_content, sticker_ref,
        sent_at, raw_event
      ) VALUES (
        ${args.messageId}, ${args.tenantId}::uuid, ${args.botId}::uuid, ${args.groupId},
        ${args.departmentId ?? null}, ${args.senderLineId ?? null}, ${args.messageType},
        ${args.textContent ?? null},
        ${args.stickerRef ? JSON.stringify(args.stickerRef) : null}::jsonb,
        ${sentAt}, ${JSON.stringify(args.rawEvent)}::jsonb
      )
      ON CONFLICT (message_id) DO NOTHING
      RETURNING (xmax = 0) AS inserted
    `);
    return { inserted: res.rows.length > 0 };
  }

  async attachMedia(tx: Db, messageId: string, mediaId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE line_message SET media_id = ${mediaId}::uuid
      WHERE message_id = ${messageId}
    `);
  }
}
