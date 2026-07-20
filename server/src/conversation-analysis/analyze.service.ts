import { Injectable, Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { currentTx } from "../db/client.js";
import { analysisUpload, analysisResult } from "../db/schema.js";
import { runPipeline } from "./pipeline/index.js";
import type { UploadCreatePayload } from "./dto/upload.dto.js";

// LINE 對話分析 · async job 執行邏輯
// 對應 docs/modules/conversation-analysis-pilot.md v0.3 §4.4
// setImmediate 排 background · 不做正式 queue（SaaS 才需要）
@Injectable()
export class AnalyzeService {
  private readonly logger = new Logger(AnalyzeService.name);
  // 單一 Anthropic client · lazy init（缺 ANTHROPIC_API_KEY 也不 crash boot、留給實際 upload 才報）
  private clientCached: Anthropic | null = null;
  private client(): Anthropic {
    if (!this.clientCached) this.clientCached = new Anthropic();
    return this.clientCached;
  }

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
      })
      .returning({ id: analysisUpload.id, status: analysisUpload.status });
    const row = rows[0];
    // async job · non-blocking · 用 setImmediate 免鎖住 request
    // 注意：job 內部無 tenant tx（AsyncLocalStorage 出 request scope 就 lose），需自己 withTenant 或用 raw db
    setImmediate(() => {
      void this.runJob(row.id).catch((e) =>
        this.logger.error(`runJob(${row.id}) uncaught: ${String((e as Error).message ?? e)}`),
      );
    });
    return row;
  }

  // Job runner · 不在 tenant tx 內（AsyncLocalStorage scope 早離開）· 直接 raw db
  // Pilot 階段 upload/result 都無 RLS · 直接讀寫 OK
  async runJob(uploadId: number): Promise<void> {
    const { db } = await import("../db/client.js");
    await db.update(analysisUpload).set({ status: "running" }).where(eq(analysisUpload.id, uploadId));
    try {
      const rows = await db
        .select({ rawContent: analysisUpload.rawContent, tenantSlug: analysisUpload.tenantSlug })
        .from(analysisUpload)
        .where(eq(analysisUpload.id, uploadId))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error(`upload ${uploadId} 不存在`);

      const result = await runPipeline(row.rawContent, row.tenantSlug, this.client());

      await db.insert(analysisResult).values({
        uploadId,
        messages: result.messages,
        dailyReports: result.dailyReports,
        records: result.records,
      });
      await db
        .update(analysisUpload)
        .set({
          status: "done",
          messageCount: result.messageCount,
          segmentCount: result.segmentCount,
          usageStats: result.usage as unknown as Record<string, unknown>,
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

  // 提供給 controller 讀 upload 列表 / 詳情
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
