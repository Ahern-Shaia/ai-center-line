import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

// 通知 audit（沿用 notification_log · v3 欄位 rule_id/source_type/channel）
// 走 raw db（webhook / 背景事件無 request tenant context）
export interface HubLogInput {
  ruleId: string;
  sourceType: string;
  channel: string;
  tenantId: string | null;
  sourceRef: string | null;   // Ragic sheetPath / 事件型別 → 存 sheet_path 欄
  recordId: number;
  status: "sent" | "skipped_dedup" | "line_failed" | "skipped_event" | "skipped_filter";
  lineStatus?: number;
  lineMessage?: string;
  latencyMs: number;
  messageText?: string;
  audit?: Record<string, unknown>;
}

@Injectable()
export class HubAuditRepository {
  private readonly logger = new Logger(HubAuditRepository.name);

  async write(input: HubLogInput): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO notification_log
          (trigger, sheet_path, record_id, status, line_status, line_message, latency_ms,
           message_text, tenant_id, audit, rule_id, source_type, channel)
        VALUES
          ('save', ${input.sourceRef ?? ""}, ${input.recordId}, ${input.status},
           ${input.lineStatus ?? null}, ${input.lineMessage ?? null}, ${input.latencyMs},
           ${input.messageText ?? null}, ${input.tenantId ?? "twh"},
           ${input.audit ? JSON.stringify(input.audit) : null}::jsonb,
           ${input.ruleId}::uuid, ${input.sourceType}, ${input.channel})
      `);
    } catch (e) {
      // audit 失敗不阻擋通知本身
      this.logger.warn(`寫 notification_log 失敗 · ${(e as Error).message}`);
    }
  }

  /**
   * 最近通知紀錄（aiproot 排查用）。
   * 沒有這個，使用者回報「Ragic 改了卻沒通知」時後台查無線索，只能靠推理。
   * 走 raw db（同 write · 此表無 RLS，靠 controller 的 permission gate 守）。
   */
  async listRecent(opts: { limit: number; ruleId?: string | null; status?: string | null }): Promise<HubLogRow[]> {
    const res = await db.execute<RawLogRow>(sql`
      SELECT l.received_at, l.status, l.sheet_path, l.record_id, l.line_status, l.line_message,
             l.latency_ms, l.message_text, l.source_type, l.channel, l.rule_id, l.audit, r.name AS rule_name
        FROM notification_log l
        LEFT JOIN notification_rule r ON r.rule_id = l.rule_id
       WHERE (${opts.ruleId ?? null}::uuid IS NULL OR l.rule_id = ${opts.ruleId ?? null}::uuid)
         AND (${opts.status ?? null}::text IS NULL OR l.status = ${opts.status ?? null}::text)
       ORDER BY l.received_at DESC
       LIMIT ${opts.limit}
    `);
    return res.rows.map((r) => ({
      receivedAt: r.received_at,
      status: r.status,
      sourceRef: r.sheet_path,
      recordId: r.record_id,
      lineStatus: r.line_status,
      lineMessage: r.line_message,
      latencyMs: r.latency_ms,
      messageText: r.message_text,
      sourceType: r.source_type,
      channel: r.channel,
      ruleId: r.rule_id,
      ruleName: r.rule_name,
      audit: r.audit,
    }));
  }
}

// drizzle execute<T> 需要 type alias（interface 沒有隱含 index signature）
type RawLogRow = {
  received_at: string; status: string; sheet_path: string | null; record_id: number | null;
  line_status: number | null; line_message: string | null; latency_ms: number | null;
  message_text: string | null; source_type: string | null; channel: string | null;
  rule_id: string | null; rule_name: string | null; audit: Record<string, unknown> | null;
};

export interface HubLogRow {
  receivedAt: string; status: string; sourceRef: string | null; recordId: number | null;
  lineStatus: number | null; lineMessage: string | null; latencyMs: number | null;
  messageText: string | null; sourceType: string | null; channel: string | null;
  ruleId: string | null; ruleName: string | null; audit: Record<string, unknown> | null;
}
