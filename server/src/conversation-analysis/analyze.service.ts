import { Injectable, Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { currentTx, type Db } from "../db/client.js";
import { analysisUpload, analysisResult } from "../db/schema.js";
import { runPipeline, defaultAnthropicProvider } from "./pipeline/index.js";
import type { UploadCreatePayload } from "./dto/upload.dto.js";
import { LlmConfigService } from "../llm/llm-config.service.js";
import { createLLMProvider } from "../llm/provider.factory.js";
import type { LLMProvider } from "../llm/provider.interface.js";

// LINE 對話分析 · async job 執行邏輯
// 對應 docs/modules/conversation-analysis-pilot.md v0.3 §4.4
// setImmediate 排 background · 不做正式 queue（SaaS 才需要）
// LLM: 若 tenant 有 llm-config → 用之 · 否則 fallback env ANTHROPIC_API_KEY
@Injectable()
export class AnalyzeService {
  private readonly logger = new Logger(AnalyzeService.name);

  constructor(private readonly llmConfig: LlmConfigService) {}

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
      })
      .returning({ id: analysisUpload.id, status: analysisUpload.status });
    const row = rows[0];
    setImmediate(() => {
      void this.runJob(row.id).catch((e) =>
        this.logger.error(`batch runJob(${row.id}) uncaught: ${String((e as Error).message ?? e)}`),
      );
    });
    return row;
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
      const rows = await db
        .select({
          rawContent: analysisUpload.rawContent,
          tenantSlug: analysisUpload.tenantSlug,
          tenantId: analysisUpload.tenantId,
        })
        .from(analysisUpload)
        .where(eq(analysisUpload.id, uploadId))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error(`upload ${uploadId} 不存在`);

      const provider = await this.resolveProvider(row.tenantId);
      const result = await runPipeline(row.rawContent, row.tenantSlug, provider);

      await db.insert(analysisResult).values({
        uploadId,
        messages: result.messages,
        dailyReports: result.dailyReports,
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
