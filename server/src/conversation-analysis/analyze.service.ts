import { Injectable, Logger, Optional } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { currentTx, type Db } from "../db/client.js";
import { analysisUpload, analysisResult } from "../db/schema.js";
import { runPipeline, defaultAnthropicProvider } from "./pipeline/index.js";
import type { UploadCreatePayload } from "./dto/upload.dto.js";
import { LlmConfigService } from "../llm/llm-config.service.js";
import { createLLMProvider } from "../llm/provider.factory.js";
import type { LLMProvider } from "../llm/provider.interface.js";
import { TicketMaterializerService } from "../warroom-task-board/ticket-materializer.service.js";

// LINE 對話分析 · async job 執行邏輯
// 對應 docs/modules/conversation-analysis-pilot.md v0.3 §4.4
// setImmediate 排 background · 不做正式 queue（SaaS 才需要）
// LLM: 若 tenant 有 llm-config → 用之 · 否則 fallback env ANTHROPIC_API_KEY
@Injectable()
export class AnalyzeService {
  private readonly logger = new Logger(AnalyzeService.name);

  constructor(
    private readonly llmConfig: LlmConfigService,
    @Optional() private readonly materializer?: TicketMaterializerService,
  ) {}

  async createUpload(
    payload: UploadCreatePayload,
    uploadedBy: string,
    tenantId: string | null,
  ): Promise<{ id: number; status: string }> {
    const tx = currentTx();
    const rows = await tx
      .insert(analysisUpload)
      .values({
        tenantId,
        tenantSlug: payload.tenantSlug,
        filename: payload.filename,
        rawContent: payload.rawContent,
        uploadedBy,
        status: "pending",
        source: "manual",
      })
      .returning({ id: analysisUpload.id, status: analysisUpload.status });
    const row = rows[0];
    setImmediate(() => {
      void this.runJob(row.id).catch((e) =>
        this.logger.error(`runJob(${row.id}) uncaught: ${String((e as Error).message ?? e)}`),
      );
    });
    return row;
  }

  /**
   * Batch 版本 · 從 convo-analysis-realtime AnalysisBatchService 呼叫
   * · tx 由 caller 傳（withSystemTx 內執行）· uploadedBy=null (cron / aiproot manual)
   * · tenantSlug 走系統標記 "batch" (不影響 pipeline · 只是 tenant_slug NOT NULL 需填)
   * · source = 'webhook' or 'webhook_manual' · pipeline 相同 · 標記讓 aggregate 分辨
   */
  async createBatchUpload(args: {
    tenantId: string;
    filename: string;
    rawContent: string;
    source: "webhook" | "webhook_manual";
    groupId: string;
    batchDate: string;
    /**
     * blob 逐行對應的 line_message.message_id（0035 · M1）
     * ⚠️ 順序必須與 rawContent 的訊息行完全一致 ——
     * materializer 拿 records[].source_ids 當索引來翻，錯位就會歸錯任務。
     */
    sourceMessageIds?: string[];
  }, tx: Db): Promise<{ id: number; status: string }> {
    const rows = await tx
      .insert(analysisUpload)
      .values({
        tenantId: args.tenantId,
        tenantSlug: "batch",
        filename: args.filename,
        rawContent: args.rawContent,
        uploadedBy: null,
        status: "pending",
        source: args.source,
        groupId: args.groupId,
        batchDate: args.batchDate,
        sourceMessageIds: args.sourceMessageIds ?? null,
      })
      .returning({ id: analysisUpload.id, status: analysisUpload.status });
    const row = rows[0];
    // ⚠️ 這裡「不」排分析工作。INSERT 還在 tx 裡，setImmediate 會在 commit 之前就跑，
    // runJob 用另一條連線讀不到這筆 → `upload N 不存在`（2026-07-27 prod 實際發生，
    // 7 群中 2 群整天沒有分析結果，batch 卻回報 completed / failed=0）。
    // 由呼叫端在 tx 結束後自己呼叫 scheduleJob()。
    return row;
  }

  /** tx commit 之後才可呼叫 —— 在 tx 內排會讀不到剛寫入的那一筆 */
  scheduleJob(uploadId: number): void {
    setImmediate(() => {
      void this.runJob(uploadId).catch((e) =>
        this.logger.error(`runJob(${uploadId}) uncaught: ${String((e as Error).message ?? e)}`),
      );
    });
  }

  // 從 tenant llm-config 建 provider · fallback env
  private async resolveProvider(tenantId: string | null): Promise<LLMProvider> {
    if (tenantId) {
      const cfg = await this.llmConfig.getForRuntime(tenantId);
      if (cfg) {
        this.logger.log(`upload runJob · 用 tenant ${tenantId} 的 llm-config · provider=${cfg.provider} model=${cfg.model}`);
        return createLLMProvider({
          provider: cfg.provider,
          model: cfg.model,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl ?? undefined,
          temperature: cfg.temperature ?? undefined,
          maxTokens: cfg.maxTokens ?? undefined,
        });
      }
    }
    this.logger.log("upload runJob · 無 tenant llm-config · fallback env Anthropic");
    return defaultAnthropicProvider();
  }

  async runJob(uploadId: number): Promise<void> {
    const { db } = await import("../db/client.js");
    await db.update(analysisUpload).set({ status: "running" }).where(eq(analysisUpload.id, uploadId));
    try {
      // 手動上傳走 request tx（呼叫端在 controller 內，無法等 commit 後才排程），
      // 這裡可能比 commit 早一步讀 → 短暫重試等它可見，真的不存在才失敗。
      // batch 路徑已改成 tx 結束後才 scheduleJob，不依賴這段。
      let row: { rawContent: string; tenantSlug: string; tenantId: string | null } | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        const rows = await db
          .select({
            rawContent: analysisUpload.rawContent,
            tenantSlug: analysisUpload.tenantSlug,
            tenantId: analysisUpload.tenantId,
          })
          .from(analysisUpload)
          .where(eq(analysisUpload.id, uploadId))
          .limit(1);
        row = rows[0];
        if (row) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!row) throw new Error(`upload ${uploadId} 不存在`);

      const provider = await this.resolveProvider(row.tenantId);
      const result = await runPipeline(row.rawContent, row.tenantSlug, provider, row.tenantId ?? undefined);

      // AAL · L2 區塊依模板存到對應欄位；general 兩邊都空。
      // 記下當時用的模板 —— 之後換模板仍能正確解讀歷史資料。
      await db.insert(analysisResult).values({
        uploadId,
        messages: result.messages,
        dailyReports: result.template === "factory_report" ? result.templateReports : [],
        serviceReports: result.template === "service_order" ? result.templateReports : [],
        extractionTemplate: result.template,
        records: result.records,
      });
      // 補進 provider / model 給 cost service 用 · runtime 讀 provider 物件
      const providerName = (provider as unknown as { name?: string }).name ?? "anthropic";
      const modelName = (provider as unknown as { model?: string; cfg?: { model?: string } }).cfg?.model
        ?? (provider as unknown as { model?: string }).model
        ?? "claude-opus-4-7";
      await db
        .update(analysisUpload)
        .set({
          status: "done",
          messageCount: result.messageCount,
          segmentCount: result.segmentCount,
          usageStats: {
            ...(result.usage as unknown as Record<string, unknown>),
            provider: providerName,
            model: modelName,
          } as Record<string, unknown>,
        })
        .where(eq(analysisUpload.id, uploadId));
      this.logger.log(
        `upload ${uploadId} done · msgs=${result.messageCount} segs=${result.segmentCount} tokens=${result.usage.outputTokens}`,
      );

      // WTB-M1 · materialize records → tickets · env kill switch WTB_MATERIALIZE_ENABLED
      if (process.env.WTB_MATERIALIZE_ENABLED !== "false" && this.materializer) {
        try {
          const mzResult = await this.materializer.materialize(uploadId);
          this.logger.log(`materialize · upload=${uploadId} inserted=${mzResult.inserted} updated=${mzResult.updated}`);
        } catch (mzErr) {
          // 材料化失敗不影響 upload 主流程 · aiproot 可手動 re-materialize
          this.logger.error(`materialize failed · upload=${uploadId} · ${String((mzErr as Error).message ?? mzErr)}`);
        }
      }
    } catch (e) {
      const errorMessage = String((e as Error).message ?? e);
      this.logger.error(`upload ${uploadId} failed: ${errorMessage}`);
      await db
        .update(analysisUpload)
        .set({ status: "failed", errorMessage })
        .where(eq(analysisUpload.id, uploadId));
    }
  }

  async listUploads() {
    const tx = currentTx();
    return tx
      .select({
        id: analysisUpload.id,
        filename: analysisUpload.filename,
        tenantSlug: analysisUpload.tenantSlug,
        uploadedAt: analysisUpload.uploadedAt,
        status: analysisUpload.status,
        errorMessage: analysisUpload.errorMessage,
        messageCount: analysisUpload.messageCount,
        segmentCount: analysisUpload.segmentCount,
      })
      .from(analysisUpload)
      .orderBy(sql`${analysisUpload.uploadedAt} desc`)
      .limit(100);
  }

  async getUploadWithResult(id: number) {
    const tx = currentTx();
    const uploadRows = await tx.select().from(analysisUpload).where(eq(analysisUpload.id, id)).limit(1);
    const upload = uploadRows[0];
    if (!upload) return null;
    const resultRows = await tx.select().from(analysisResult).where(eq(analysisResult.uploadId, id)).limit(1);
    const result = resultRows[0] ?? null;
    return { upload, result };
  }
}
