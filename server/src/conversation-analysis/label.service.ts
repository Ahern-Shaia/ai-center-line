import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { currentTx, withSystemTx } from "../db/client.js";
import { analysisLabel } from "../db/schema.js";
import type { LabelCreatePayload } from "./dto/label.dto.js";

type TargetType = "classification" | "daily_report" | "record";

export interface LabelInsights {
  // 跨批準確率（label-driven-improvement §5.1）· correct/total per target_type
  accuracy: Record<TargetType, { total: number; correct: number }>;
  // 錯誤分群入口（§5.2）· 標「錯誤」的案例 + 內容，讓人看出「老是把 A 當 B」
  errors: Array<{
    uploadId: number; targetType: TargetType; targetId: string;
    tenantSlug: string; filename: string;
    content: string; category: string | null; note: string | null; labeledAt: string;
  }>;
}

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

  /**
   * 跨批標記洞察（label-driven-improvement M1+M2）· aiproot 看全、租戶只看自家。
   * 走 withSystemTx（analysis_* 無租戶 RLS escape）+ 明確 tenantId 過濾 → 不靠 RLS 靜默。
   * tenantId=null ＝平台層（aiproot/consultant）看全部。
   */
  async getInsights(tenantId: string | null): Promise<LabelInsights> {
    return withSystemTx(async (tx) => {
      const scope = tenantId ? sql`AND u.tenant_id = ${tenantId}::uuid` : sql``;

      const acc = await tx.execute<{ target_type: TargetType; total: number; correct: number }>(sql`
        SELECT al.target_type, COUNT(*)::int AS total, SUM(al.correct::int)::int AS correct
        FROM analysis_label al JOIN analysis_upload u ON u.id = al.upload_id
        WHERE TRUE ${scope}
        GROUP BY al.target_type
      `);
      const accMap = new Map(acc.rows.map((r) => [r.target_type, r]));
      const pick = (t: TargetType) => ({ total: accMap.get(t)?.total ?? 0, correct: accMap.get(t)?.correct ?? 0 });

      const errs = await tx.execute<{
        upload_id: number; target_type: TargetType; target_id: string;
        note: string | null; labeled_at: string; tenant_slug: string; filename: string;
      }>(sql`
        SELECT al.upload_id, al.target_type, al.target_id, al.note, al.labeled_at::text AS labeled_at,
               u.tenant_slug, u.filename
        FROM analysis_label al JOIN analysis_upload u ON u.id = al.upload_id
        WHERE al.correct = false ${scope}
        ORDER BY al.labeled_at DESC
        LIMIT 200
      `);

      // 取回錯誤標的的內容（classification=訊息 id / record|daily_report=陣列 index）
      const uploadIds = [...new Set(errs.rows.map((r) => r.upload_id))];
      const content = new Map<number, { messages: Array<Record<string, unknown>>; records: Array<Record<string, unknown>>; daily_reports: Array<Record<string, unknown>> }>();
      if (uploadIds.length > 0) {
        const idList = sql.join(uploadIds.map((id) => sql`${id}`), sql`, `);
        const ar = await tx.execute<{ upload_id: number; messages: unknown; records: unknown; daily_reports: unknown }>(sql`
          SELECT upload_id, messages, records, daily_reports FROM analysis_result WHERE upload_id IN (${idList})
        `);
        for (const r of ar.rows) {
          content.set(r.upload_id, {
            messages: (r.messages as Array<Record<string, unknown>>) ?? [],
            records: (r.records as Array<Record<string, unknown>>) ?? [],
            daily_reports: (r.daily_reports as Array<Record<string, unknown>>) ?? [],
          });
        }
      }

      const errors = errs.rows.map((e) => {
        const c = content.get(e.upload_id);
        let text = ""; let category: string | null = null;
        if (c) {
          if (e.target_type === "classification") {
            const m = c.messages.find((x) => String(x.id) === e.target_id);
            text = (m?.text as string) ?? ""; category = (m?.category as string) ?? null;
          } else if (e.target_type === "record") {
            const r = c.records[Number(e.target_id)];
            text = (r?.title as string) || (r?.detail as string) || ""; category = (r?.category as string) ?? null;
          } else {
            const d = c.daily_reports[Number(e.target_id)];
            text = (d?.reporter_name as string) || (d?.machine_code as string) || JSON.stringify(d ?? {}).slice(0, 80);
          }
        }
        return {
          uploadId: e.upload_id, targetType: e.target_type, targetId: e.target_id,
          tenantSlug: e.tenant_slug, filename: e.filename, content: text, category, note: e.note, labeledAt: e.labeled_at,
        };
      });

      return {
        accuracy: { classification: pick("classification"), daily_report: pick("daily_report"), record: pick("record") },
        errors,
      };
    });
  }
}
