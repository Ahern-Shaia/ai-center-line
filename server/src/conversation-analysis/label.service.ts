import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";
import { analysisLabel } from "../db/schema.js";
import type { LabelCreatePayload } from "./dto/label.dto.js";

// Label service · pattern 抄 signoff（audit fields labeled_by / labeled_at · role guard on controller）
// 對應 docs/modules/conversation-analysis-pilot.md v0.3 §6
@Injectable()
export class LabelService {
  async createLabel(payload: LabelCreatePayload, labeledBy: string): Promise<{ id: number }> {
    const tx = currentTx();
    // Upsert 語意：同 (upload_id, target_type, target_id, labeled_by) 已存在 → 更新 correct/note
    const rows = await tx
      .insert(analysisLabel)
      .values({
        uploadId: payload.uploadId,
        targetType: payload.targetType,
        targetId: payload.targetId,
        correct: payload.correct,
        note: payload.note ?? null,
        labeledBy,
      })
      .onConflictDoUpdate({
        target: [analysisLabel.uploadId, analysisLabel.targetType, analysisLabel.targetId, analysisLabel.labeledBy],
        set: {
          correct: payload.correct,
          note: payload.note ?? null,
          labeledAt: new Date(),
        },
      })
      .returning({ id: analysisLabel.id });
    return rows[0];
  }

  async listLabelsForUpload(uploadId: number) {
    const tx = currentTx();
    return tx
      .select({
        targetType: analysisLabel.targetType,
        targetId: analysisLabel.targetId,
        correct: analysisLabel.correct,
        note: analysisLabel.note,
        labeledBy: analysisLabel.labeledBy,
        labeledAt: analysisLabel.labeledAt,
      })
      .from(analysisLabel)
      .where(eq(analysisLabel.uploadId, uploadId));
  }

  // 三大 metric（§6.3）· pilot 版精簡 · 三 metric 各 group by target_type 算比例
  async getMetrics(uploadId: number) {
    const tx = currentTx();
    const rows = await tx.execute<{
      target_type: "classification" | "daily_report" | "record";
      total: number;
      correct_count: number;
    }>(sql`
      SELECT target_type,
             COUNT(*)::int AS total,
             SUM(CASE WHEN correct THEN 1 ELSE 0 END)::int AS correct_count
      FROM analysis_label
      WHERE upload_id = ${uploadId}
      GROUP BY target_type
    `);
    const byType = new Map(rows.rows.map((r) => [r.target_type, r]));

    const c = byType.get("classification");
    const d = byType.get("daily_report");
    const r = byType.get("record");

    return {
      contamination_rate: c && c.total > 0 ? 1 - c.correct_count / c.total : null,
      daily_report_accuracy: d && d.total > 0 ? d.correct_count / d.total : null,
      record_accuracy: r && r.total > 0 ? r.correct_count / r.total : null,
      label_count: (c?.total ?? 0) + (d?.total ?? 0) + (r?.total ?? 0),
      by_type: { classification: c ?? null, daily_report: d ?? null, record: r ?? null },
    };
  }

  async deleteLabel(uploadId: number, targetType: string, targetId: string, labeledBy: string): Promise<void> {
    const tx = currentTx();
    await tx
      .delete(analysisLabel)
      .where(
        and(
          eq(analysisLabel.uploadId, uploadId),
          eq(analysisLabel.targetType, targetType as "classification" | "daily_report" | "record"),
          eq(analysisLabel.targetId, targetId),
          eq(analysisLabel.labeledBy, labeledBy),
        ),
      );
  }
}
