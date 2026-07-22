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
    senderUserId?: string | null;               // 0016 · 若 binding 已存在 · 落庫時對到 aiproot user
    chatContext?: "group" | "personal";          // 0016 · default 'group'
    messageType: string;
    textContent: string | null;
    stickerRef: Record<string, unknown> | null;
    sentAtMs: number;
    rawEvent: Record<string, unknown>;
  }): Promise<{ inserted: boolean }> {
    const sentAt = new Date(args.sentAtMs).toISOString();
    const chatContext = args.chatContext ?? "group";
    // ON CONFLICT DO NOTHING · LINE retry 冪等 (messageId 是 LINE 全域唯一)
    const res = await tx.execute<{ inserted: boolean }>(sql`
      INSERT INTO line_message (
        message_id, tenant_id, bot_id, group_id, department_id,
        sender_line_id, sender_user_id, chat_context,
        message_type, text_content, sticker_ref,
        sent_at, raw_event
      ) VALUES (
        ${args.messageId}, ${args.tenantId}::uuid, ${args.botId}::uuid, ${args.groupId},
        ${args.departmentId ?? null}, ${args.senderLineId ?? null},
        ${args.senderUserId ?? null}::uuid, ${chatContext},
        ${args.messageType},
        ${args.textContent ?? null},
        ${args.stickerRef ? JSON.stringify(args.stickerRef) : null}::jsonb,
        ${sentAt}, ${JSON.stringify(args.rawEvent)}::jsonb
      )
      ON CONFLICT (message_id) DO NOTHING
      RETURNING (xmax = 0) AS inserted
    `);
    return { inserted: res.rows.length > 0 };
  }

  /**
   * 拉某 aiproot user 某天私訊 · 個人日報 pipeline 用
   * batchDate 格式: "YYYY-MM-DD" (Asia/Taipei)
   */
  async listPersonalByUserDay(tx: Db, args: {
    userId: string;
    batchDate: string;
  }): Promise<Array<{
    messageId: string;
    messageType: string;
    textContent: string | null;
    sentAt: Date;
  }>> {
    const res = await tx.execute<{
      message_id: string;
      message_type: string;
      text_content: string | null;
      sent_at: string;
    }>(sql`
      SELECT message_id, message_type, text_content, sent_at::text AS sent_at
      FROM line_message
      WHERE sender_user_id = ${args.userId}::uuid
        AND chat_context = 'personal'
        AND (sent_at AT TIME ZONE 'Asia/Taipei')::date = ${args.batchDate}::date
      ORDER BY sent_at ASC
    `);
    return res.rows.map((r) => ({
      messageId: r.message_id,
      messageType: r.message_type,
      textContent: r.text_content,
      sentAt: new Date(r.sent_at),
    }));
  }

  /**
   * 找活躍但未綁定的 UserId · 提示 aiproot 追人綁定（方向 3 nudge）
   * 定期 job 用
   */
  async findUnboundActiveUsers(tx: Db, tenantId: string, lookbackDays: number = 7): Promise<Array<{
    senderLineId: string;
    displayName: string | null;
    messageCount: number;
    lastActiveAt: string;
    topGroupName: string | null;
  }>> {
    const res = await tx.execute<{
      sender_line_id: string;
      display_name: string | null;
      message_count: string;
      last_active_at: string;
      top_group_name: string | null;
    }>(sql`
      WITH activity AS (
        SELECT lm.sender_line_id,
               count(*)::text AS message_count,
               max(lm.sent_at)::text AS last_active_at,
               mode() WITHIN GROUP (ORDER BY lg.display_name) AS top_group_name
        FROM line_message lm
        LEFT JOIN line_group lg ON lg.bot_id = lm.bot_id AND lg.group_id = lm.group_id
        LEFT JOIN user_line_binding b
          ON b.bot_id = lm.bot_id
         AND b.line_user_id = lm.sender_line_id
         AND b.status = 'active'
        WHERE lm.tenant_id = ${tenantId}::uuid
          AND lm.sent_at > (now() - (${lookbackDays} || ' days')::interval)
          AND lm.sender_line_id IS NOT NULL
          AND b.binding_id IS NULL                    -- 未綁定
        GROUP BY lm.sender_line_id
      )
      SELECT a.sender_line_id, mem.display_name,
             a.message_count, a.last_active_at, a.top_group_name
      FROM activity a
      LEFT JOIN line_member mem
        ON mem.user_id = a.sender_line_id
       AND mem.fetch_error IS NULL
      ORDER BY a.message_count::int DESC
      LIMIT 100
    `);
    return res.rows.map((r) => ({
      senderLineId: r.sender_line_id,
      displayName: r.display_name,
      messageCount: parseInt(r.message_count, 10),
      lastActiveAt: r.last_active_at,
      topGroupName: r.top_group_name,
    }));
  }

  async attachMedia(tx: Db, messageId: string, mediaId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE line_message SET media_id = ${mediaId}::uuid
      WHERE message_id = ${messageId}
    `);
  }

  /**
   * 拉某 tenant 某 group 某天訊息 · 時序排序
   * batchDate 格式: "YYYY-MM-DD" (客戶 UTC+8 一日)
   * LEFT JOIN line_member 取 displayName · 未 fetch or 失敗則 null
   */
  async listByGroupDay(tx: Db, args: {
    tenantId: string;
    groupId: string;
    batchDate: string;
  }): Promise<Array<{
    messageId: string;
    senderLineId: string | null;
    senderDisplayName: string | null;
    messageType: string;
    textContent: string | null;
    stickerRef: { packageId?: string; stickerId?: string } | null;
    sentAt: Date;
  }>> {
    const startLocal = `${args.batchDate} 00:00:00+08`;
    const endLocal = `${args.batchDate} 00:00:00+08`;
    const res = await tx.execute<{
      message_id: string;
      sender_line_id: string | null;
      sender_display_name: string | null;
      message_type: string;
      text_content: string | null;
      sticker_ref: { packageId?: string; stickerId?: string } | null;
      sent_at: string;
    }>(sql`
      SELECT lm.message_id, lm.sender_line_id,
             mem.display_name AS sender_display_name,
             lm.message_type, lm.text_content, lm.sticker_ref,
             lm.sent_at::text AS sent_at
      FROM line_message lm
      LEFT JOIN line_member mem
        ON mem.bot_id = lm.bot_id
       AND mem.group_id = lm.group_id
       AND mem.user_id = lm.sender_line_id
       AND mem.fetch_error IS NULL              -- fetch 失敗的 row · 顯 pseudonym 而非 placeholder
      WHERE lm.tenant_id = ${args.tenantId}::uuid
        AND lm.group_id = ${args.groupId}
        AND lm.sent_at >= ${startLocal}::timestamptz
        AND lm.sent_at < (${endLocal}::timestamptz + interval '1 day')
      ORDER BY lm.sent_at ASC
    `);
    return res.rows.map((r) => ({
      messageId: r.message_id,
      senderLineId: r.sender_line_id,
      senderDisplayName: r.sender_display_name,
      messageType: r.message_type,
      textContent: r.text_content,
      stickerRef: r.sticker_ref,
      sentAt: new Date(r.sent_at),
    }));
  }

  /**
   * 掃「哪些 (tenant, group, batch_date) 有訊息但還沒 batch」 · cron / 手動用
   * lookback: 近 N 天 · 通常 = 2 (昨日 + 前日 · 防上次 cron 漏)
   * tenantId: optional · 傳則限單 tenant (前端下拉選了單一租戶時用)
   */
  async findPendingBatches(tx: Db, lookbackDays: number = 2, tenantId?: string): Promise<Array<{
    tenantId: string;
    groupId: string;
    batchDate: string;
    messageCount: number;
  }>> {
    const res = await tx.execute<{
      tenant_id: string;
      group_id: string;
      batch_date: string;
      message_count: string;
    }>(sql`
      SELECT lm.tenant_id::text AS tenant_id,
             lm.group_id,
             (lm.sent_at AT TIME ZONE 'Asia/Taipei')::date::text AS batch_date,
             count(*)::text AS message_count
      FROM line_message lm
      LEFT JOIN analysis_batch ab
        ON ab.tenant_id = lm.tenant_id
       AND ab.group_id = lm.group_id
       AND ab.batch_date = (lm.sent_at AT TIME ZONE 'Asia/Taipei')::date
      WHERE lm.sent_at >= (now() AT TIME ZONE 'Asia/Taipei' - (${lookbackDays} || ' days')::interval)::timestamptz
        AND ab.batch_id IS NULL
        AND (${tenantId ?? null}::uuid IS NULL OR lm.tenant_id = ${tenantId ?? null}::uuid)
        -- 手動 (tenantId 有值) 忽略 batch_enabled · 走 UI 使用者意志
        -- cron (tenantId=null) 強制 join tenants filter batch_enabled=true
        AND (${tenantId ?? null}::uuid IS NOT NULL OR EXISTS (
          SELECT 1 FROM tenants t
          WHERE t.tenant_id = lm.tenant_id AND t.batch_enabled = true
        ))
      GROUP BY lm.tenant_id, lm.group_id, (lm.sent_at AT TIME ZONE 'Asia/Taipei')::date
    `);
    return res.rows.map((r) => ({
      tenantId: r.tenant_id,
      groupId: r.group_id,
      batchDate: r.batch_date,
      messageCount: parseInt(r.message_count, 10),
    }));
  }
}
