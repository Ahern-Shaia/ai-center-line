import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { notificationLog } from "../db/schema.js";

// notify.repository — 寫 notification_log。
// notify endpoint 不走 JwtAuthGuard 也不走 TenantTxInterceptor（無 tenant tx），所以直接用 raw `db`。
// Phase 1 不掛 RLS；Phase 2 多租戶時改走 withTenant。

export interface WriteLogInput {
  trigger: "save" | "button";
  sheetPath: string;
  recordId: number;
  status: "sent" | "skipped_dedup" | "line_failed" | "invalid_body" | "invalid_secret";
  lineStatus?: number;
  lineMessage?: string;
  latencyMs: number;
  messageText?: string;
  tenantId?: string | null;
  audit?: Record<string, unknown>;
}

@Injectable()
export class NotifyRepository implements OnModuleInit {
  private readonly logger = new Logger(NotifyRepository.name);

  // D2 緩解（notify.md §12）：startup 檢查 notification_log 表存在。
  // 缺表 → 大聲 log error 讓 dev 立刻發現，但不 crash app（讓其他 route 仍能 serve）。
  async onModuleInit(): Promise<void> {
    try {
      await db.execute(sql`SELECT 1 FROM notification_log LIMIT 1`);
      this.logger.log("notification_log 表就緒 ✓");
    } catch (e) {
      this.logger.error(
        `🚨 notification_log 表缺失或無存取權！notify endpoint 會 5xx。請跑 migrations/0003_notification_log.sql。原始錯誤：${String((e as Error).message ?? e)}`,
      );
    }
  }

  async writeLog(input: WriteLogInput): Promise<{ id: number; requestId: string } | null> {
    try {
      const rows = await db
        .insert(notificationLog)
        .values({
          trigger: input.trigger,
          sheetPath: input.sheetPath,
          recordId: input.recordId,
          status: input.status,
          lineStatus: input.lineStatus,
          lineMessage: input.lineMessage,
          latencyMs: input.latencyMs,
          messageText: input.messageText,
          tenantId: input.tenantId ?? null,
          audit: input.audit ?? {},
        })
        .returning({ id: notificationLog.id, requestId: notificationLog.requestId });
      return rows[0] ?? null;
    } catch (e) {
      // Log 寫失敗不影響通知已發（§7-bis.3 D1）
      this.logger.error(`notification_log 寫入失敗: ${String((e as Error).message ?? e)}`);
      return null;
    }
  }
}
