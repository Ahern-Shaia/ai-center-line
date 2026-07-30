import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { deriveAnalysisState, needsAttention, type AnalysisState } from "./analysis-state.js";

export interface AnalysisBatchRow {
  batchId: string;
  tenantId: string;
  groupId: string;
  batchDate: string;
  uploadId: number | null;
  status: "pending" | "running" | "completed" | "failed" | "empty";
  messageCount: number;
  triggeredBy: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  /**
   * ⚠️ 顯示狀態一律看這個，不要看 `status`。
   * `status` 是「訊息收齊、分析已排入」，不是分析結果（見 analysis-state.ts）。
   */
  analysisState: AnalysisState;
  /** `analysis_upload.status` 原始值 · stuck 時要顯示給人判斷（pending＝沒開始 / running＝跑一半） */
  uploadStatus: string | null;
  /** 分析階段的錯誤訊息 · 與 `errorMessage`（收訊息階段）分開 */
  analysisError: string | null;
  /**
   * 要人看一眼嗎。**由後端算**，前端不要自己維護一份狀態集合 ——
   * 兩邊各存一份的話，新增狀態時漏改前端會讓它安靜地不進「需檢查」。
   */
  needsAttention: boolean;
}

@Injectable()
export class AnalysisBatchRepository {
  /**
   * P1-fix M2 · idempotent check · runBatch 開頭呼叫
   * 若已存在且 status=completed / empty · caller 決定 skip 或 rerun
   */
  async getExisting(tx: Db, args: {
    tenantId: string;
    groupId: string;
    batchDate: string;
  }): Promise<{ batchId: string; status: string; uploadId: number | null; messageCount: number } | null> {
    const res = await tx.execute<{ batch_id: string; status: string; upload_id: number | null; message_count: number }>(sql`
      SELECT batch_id, status, upload_id, message_count
      FROM analysis_batch
      WHERE tenant_id = ${args.tenantId}::uuid
        AND group_id = ${args.groupId}
        AND batch_date = ${args.batchDate}::date
      LIMIT 1
    `);
    const row = res.rows[0];
    if (!row) return null;
    return { batchId: row.batch_id, status: row.status, uploadId: row.upload_id, messageCount: row.message_count };
  }

  /**
   * 開始 batch · 冪等 UNIQUE (tenant_id, group_id, batch_date)
   * 若已存在 (手動重跑) · 覆蓋 upload_id 前值 · 狀態改回 running
   * 回 batchId + 是否 first (供 log)
   */
  async startBatch(tx: Db, args: {
    tenantId: string;
    groupId: string;
    batchDate: string;
    triggeredBy: string;
  }): Promise<{ batchId: string; isFirst: boolean }> {
    const res = await tx.execute<{ batch_id: string; first: boolean }>(sql`
      INSERT INTO analysis_batch (tenant_id, group_id, batch_date, status, triggered_by, started_at)
      VALUES (${args.tenantId}::uuid, ${args.groupId}, ${args.batchDate}::date,
              'running', ${args.triggeredBy}, now())
      ON CONFLICT (tenant_id, group_id, batch_date) DO UPDATE SET
        status = 'running',
        triggered_by = EXCLUDED.triggered_by,
        started_at = now(),
        error_message = NULL,
        updated_at = now()
      RETURNING batch_id, (xmax = 0) AS first
    `);
    const row = res.rows[0];
    if (!row) throw new Error("analysis_batch startBatch 未回 batch_id");
    return { batchId: row.batch_id, isFirst: row.first };
  }

  async markCompleted(tx: Db, batchId: string, args: {
    uploadId: number;
    messageCount: number;
  }): Promise<void> {
    await tx.execute(sql`
      UPDATE analysis_batch SET
        status = 'completed',
        upload_id = ${args.uploadId},
        message_count = ${args.messageCount},
        completed_at = now(),
        updated_at = now()
      WHERE batch_id = ${batchId}::uuid
    `);
  }

  async markEmpty(tx: Db, batchId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE analysis_batch SET
        status = 'empty',
        message_count = 0,
        completed_at = now(),
        updated_at = now()
      WHERE batch_id = ${batchId}::uuid
    `);
  }

  async markFailed(tx: Db, batchId: string, errorMessage: string): Promise<void> {
    await tx.execute(sql`
      UPDATE analysis_batch SET
        status = 'failed',
        error_message = ${errorMessage},
        completed_at = now(),
        updated_at = now()
      WHERE batch_id = ${batchId}::uuid
    `);
  }

  async listByTenant(tx: Db, args: {
    tenantId?: string;
    limit?: number;
  }): Promise<AnalysisBatchRow[]> {
    // LEFT JOIN analysis_upload · batch.status 不是分析結果（見 analysis-state.ts）。
    // `stale` 用 DB 的時鐘算，不用 Node 的 —— 兩邊時區/時鐘不一致時
    // 「超過 30 分鐘了嗎」會給出兩種答案。
    const res = await tx.execute<{
      batch_id: string; tenant_id: string; group_id: string; batch_date: string;
      upload_id: number | null; status: AnalysisBatchRow["status"]; message_count: number;
      triggered_by: string; started_at: string | null; completed_at: string | null;
      error_message: string | null; upload_status: string | null;
      analysis_error: string | null; stale: boolean;
    }>(sql`
      SELECT b.batch_id, b.tenant_id, b.group_id, b.batch_date::text, b.upload_id, b.status,
             b.message_count, b.triggered_by,
             b.started_at::text, b.completed_at::text, b.error_message,
             u.status AS upload_status,
             u.error_message AS analysis_error,
             (coalesce(b.completed_at, b.started_at) < now() - interval '30 minutes') AS stale
      FROM analysis_batch b
      LEFT JOIN analysis_upload u ON u.id = b.upload_id
      WHERE (${args.tenantId ?? null}::uuid IS NULL OR b.tenant_id = ${args.tenantId ?? null}::uuid)
      ORDER BY b.batch_date DESC, b.tenant_id ASC
      LIMIT ${args.limit ?? 200}
    `);
    return res.rows.map((r) => {
      const state = deriveAnalysisState({
        batchStatus: r.status,
        uploadId: r.upload_id,
        uploadStatus: r.upload_status,
        // completed_at / started_at 都是 NULL 時當成「剛建立」而不是「卡住」——
        // 寧可少報一次，不要把正在跑的報成失敗（狼來了會讓人開始忽略這個儀表）。
        stale: r.stale ?? false,
      });
      return {
        batchId: r.batch_id,
        tenantId: r.tenant_id,
        groupId: r.group_id,
        batchDate: r.batch_date,
        uploadId: r.upload_id,
        status: r.status,
        messageCount: r.message_count,
        triggeredBy: r.triggered_by,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        errorMessage: r.error_message,
        analysisState: state,
        uploadStatus: r.upload_status,
        analysisError: r.analysis_error,
        needsAttention: needsAttention(state),
      };
    });
  }
}
