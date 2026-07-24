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
}
