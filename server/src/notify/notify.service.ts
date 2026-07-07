import { Injectable, Logger } from "@nestjs/common";
import { LineClient } from "./line.client.js";
import { NotifyRepository } from "./notify.repository.js";
import { MemoryDedupCache, type DedupCache } from "./dedup.js";
import { composeMaintenanceReportMessage } from "./compose/compose-maintenance-report.js";
import type { RagicMaintenanceReportPayload } from "./dto/ragic-maintenance-report.dto.js";

export interface HandleResult {
  status: "sent" | "skipped_dedup" | "line_failed";
  requestId?: string;
  lineStatus?: number;
  lineMessage?: string;
}

// 編排：dedup → compose → LINE push → audit log。
// dedup 是 in-memory；backend 單 replica 假設下有效（Phase 1 §6.2）。
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);
  // dedup 直接在類別欄位建立 default；不從 DI 注入（interface 無 runtime metadata）。
  // 測試要換：直接改本欄或用 setDedupCache（僅測試用）。
  private dedup: DedupCache = new MemoryDedupCache(30_000);

  constructor(
    private readonly lineClient: LineClient,
    private readonly repo: NotifyRepository,
  ) {}

  /** 僅測試用：注入 fake dedup cache（生產不用） */
  setDedupCache(cache: DedupCache): void {
    this.dedup = cache;
  }

  async handleMaintenanceReport(payload: RagicMaintenanceReportPayload): Promise<HandleResult> {
    const startedAt = Date.now();
    const { trigger, sheetPath, recordId, record } = payload;

    // 1) Dedup 30 秒窗
    if (this.dedup.shouldSkip(sheetPath, recordId)) {
      const latencyMs = Date.now() - startedAt;
      const logged = await this.repo.writeLog({
        trigger, sheetPath, recordId,
        status: "skipped_dedup",
        latencyMs,
        audit: { reason: "within_30s_window" },
      });
      return { status: "skipped_dedup", requestId: logged?.requestId };
    }

    // 2) Compose 訊息
    const text = composeMaintenanceReportMessage(record, trigger);

    // 3) Push LINE
    const lineResult = await this.lineClient.pushText(text);

    // 4) Audit log
    const latencyMs = Date.now() - startedAt;
    if (lineResult.ok) {
      const logged = await this.repo.writeLog({
        trigger, sheetPath, recordId,
        status: "sent",
        latencyMs,
        messageText: text,
        audit: { lineRequestId: lineResult.requestId ?? null },
      });
      return { status: "sent", requestId: logged?.requestId };
    }

    // LINE 失敗：不 retry（OQ-NOT-4 A）
    const logged = await this.repo.writeLog({
      trigger, sheetPath, recordId,
      status: "line_failed",
      lineStatus: lineResult.status,
      lineMessage: lineResult.message,
      latencyMs,
      messageText: text,
    });
    this.logger.warn(`LINE push failed: status=${lineResult.status} msg=${lineResult.message}`);
    return {
      status: "line_failed",
      requestId: logged?.requestId,
      lineStatus: lineResult.status,
      lineMessage: lineResult.message,
    };
  }
}
