import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { withSystemTx } from "../db/client.js";
import { AnalyzeService } from "../conversation-analysis/analyze.service.js";
import { LineMessageRepository } from "../line-ingest/line-message.repository.js";
import { AnalysisBatchRepository } from "./analysis-batch.repository.js";
import { formatAsLineExport } from "./line-message.formatter.js";

/**
 * AnalysisBatchService · 一 tenant × group × day → 一 batch
 * 冪等：手動重跑同 (tenant, group, date) → 覆蓋 upload_id · 舊 upload row 保留 · 未來可加 replay_of
 *
 * Flow:
 *  1. startBatch (冪等 · running 狀態)
 *  2. listByGroupDay 拉當天所有訊息
 *  3. empty → markEmpty · 早退
 *  4. formatAsLineExport 拼 blob
 *  5. 走 conversation-analysis 現有 pipeline (AnalyzeService.createUpload)
 *  6. markCompleted with uploadId · analysis_upload 標 source=webhook / group_id / batch_date
 *
 * FMEA:
 * - B1 (Anthropic 500 全 batch fail) → markFailed · aiproot 手動 UI 重跑
 * - B2 (當天群無訊息) → markEmpty · 不寫 analysis_upload
 * - B3 (冪等重跑) → startBatch ON CONFLICT DO UPDATE · 新 upload row · source=webhook_manual
 * - B4 (blob > Anthropic context) → 目前不 check length · v2 加 pre-check + 分段 (P1 殘留)
 */
@Injectable()
export class AnalysisBatchService {
  private readonly logger = new Logger(AnalysisBatchService.name);

  constructor(
    private readonly analyzeService: AnalyzeService,
    private readonly messageRepo: LineMessageRepository,
    private readonly batchRepo: AnalysisBatchRepository,
  ) {}

  /**
   * 跑一 batch · 呼叫者自訂 triggeredBy ("cron" | "manual:<user_id>")
   */
  async runBatch(args: {
    tenantId: string;
    groupId: string;
    batchDate: string;      // "YYYY-MM-DD"
    triggeredBy: string;    // "cron" or "manual:<uuid>"
  }): Promise<{
    batchId: string;
    status: "completed" | "empty" | "failed";
    uploadId: number | null;
    messageCount: number;
  }> {
    // 決定 source · 手動 vs cron
    const isManual = args.triggeredBy.startsWith("manual:") || args.triggeredBy.startsWith("manual-tenant:");
    const source: "webhook" | "webhook_manual" = isManual ? "webhook_manual" : "webhook";

    // P1-fix M2 · idempotent · cron 情境若已 completed 直接 return existing
    // (manual 情境用戶明說要 rerun · 不 skip)
    if (!isManual) {
      const existing = await withSystemTx((tx) => this.batchRepo.getExisting(tx, args));
      if (existing && (existing.status === "completed" || existing.status === "empty")) {
        this.logger.log(`batch skip · ${args.tenantId}/${args.groupId}/${args.batchDate} · already ${existing.status} · batchId=${existing.batchId}`);
        return {
          batchId: existing.batchId,
          status: existing.status as "completed" | "empty",
          uploadId: existing.uploadId,
          messageCount: existing.messageCount,
        };
      }
    }

    // 1. startBatch · 冪等
    const { batchId } = await withSystemTx((tx) => this.batchRepo.startBatch(tx, args));
    this.logger.log(`batch start · ${args.tenantId}/${args.groupId}/${args.batchDate} · triggeredBy=${args.triggeredBy} · batchId=${batchId}`);

    try {
      // 2. 拉訊息
      const messages = await withSystemTx((tx) => this.messageRepo.listByGroupDay(tx, {
        tenantId: args.tenantId,
        groupId: args.groupId,
        batchDate: args.batchDate,
      }));

      if (messages.length === 0) {
        await withSystemTx((tx) => this.batchRepo.markEmpty(tx, batchId));
        return { batchId, status: "empty", uploadId: null, messageCount: 0 };
      }

      // 3. 拼 blob · 群名從 line_group 或 line_bot 拉 · 這裡走簡版查詢
      const groupName = await this.resolveGroupName(args.tenantId, args.groupId);
      const blob = formatAsLineExport(groupName, args.batchDate, messages);

      // 4. 走 AnalyzeService · createUpload 內部 setImmediate 跑分析
      //    filename 標 batch 來源 · 便於後台辨識
      const filename = `[realtime] ${args.groupId} · ${args.batchDate} · ${messages.length} 則`;
      const upload = await withSystemTx((tx) => this.analyzeService.createBatchUpload({
        tenantId: args.tenantId,
        filename,
        rawContent: blob,
        source,
        groupId: args.groupId,
        batchDate: args.batchDate,
      }, tx));

      // 5. mark
      await withSystemTx((tx) => this.batchRepo.markCompleted(tx, batchId, {
        uploadId: upload.id,
        messageCount: messages.length,
      }));

      // 6. tx 都結束了才排分析 —— 在 createBatchUpload 的 tx 內排會讀不到剛寫入那筆
      //    （runJob 走另一條連線 → `upload N 不存在`，且 batch 仍回報 completed）
      this.analyzeService.scheduleJob(upload.id);

      this.logger.log(`batch done · batchId=${batchId} · uploadId=${upload.id} · messages=${messages.length}`);
      return { batchId, status: "completed", uploadId: upload.id, messageCount: messages.length };
    } catch (err) {
      const errMsg = (err as Error).message ?? String(err);
      this.logger.error(`batch failed · batchId=${batchId} · ${errMsg}`);
      await withSystemTx((tx) => this.batchRepo.markFailed(tx, batchId, errMsg));
      return { batchId, status: "failed", uploadId: null, messageCount: 0 };
    }
  }

  private async resolveGroupName(tenantId: string, groupId: string): Promise<string> {
    const res = await withSystemTx((tx) => tx.execute<{ display_name: string | null }>(sql`
      SELECT lg.display_name
      FROM line_group lg
      JOIN line_bot lb ON lb.bot_id = lg.bot_id
      WHERE lb.tenant_id = ${tenantId}::uuid AND lg.group_id = ${groupId}
      LIMIT 1
    `));
    return res.rows[0]?.display_name ?? groupId;
  }
}
