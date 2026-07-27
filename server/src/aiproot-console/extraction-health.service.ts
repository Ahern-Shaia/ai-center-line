import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";
import { L1_TRACKED_FIELDS } from "../conversation-analysis/pipeline/schemas.js";
import { TEMPLATE_REGISTRY, resolveTemplate } from "../conversation-analysis/pipeline/templates.js";

// 抽取健康度 · 對照 docs/modules/ai-analysis-layering.md §5 + M2
//
// 存在理由：2026-07-27 發現台灣福祉的 schema 不合（機台 7% / 工單 8%），
// 是「手動連 prod DB 撈」才發現的。模板選錯的訊號很明確（某欄位長期趨近 0%），
// 但沒人看得到就等於不存在 —— 新客戶開通跑一週就該知道套對沒有，而不是等客戶抱怨。
//
// ⚠️ 走 currentTx() 不是 withSystemTx：tenants 的 RLS policy 只認 'aiproot_admin'，
//    withSystemTx 設的是 'system' → 一列都讀不到（靜默回空，不報錯）。
//    currentTx 繼承 JWT 身分，與既有 AiprootTenantsController 一致。
//    analysis_upload / analysis_result 無 RLS，兩種都讀得到。

export interface FieldFill {
  field: string;
  layer: "L1" | "L2";
  filled: number;
  total: number;
  rate: number;          // 0–100
}

export interface TenantHealth {
  tenantId: string;
  tenantName: string;
  template: string;
  templateLabel: string;
  messageCount: number;      // 期間內 AI 讀過的訊息數
  recordCount: number;       // L1 產出
  templateReportCount: number; // L2 產出
  confidence: { high: number; medium: number; low: number };
  fields: FieldFill[];
  warnings: string[];
}

const PERIOD_DAYS_MAX = 90;

@Injectable()
export class ExtractionHealthService {
  async overview(days: number): Promise<{ days: number; tenants: TenantHealth[] }> {
    const d = Number.isFinite(days) && days > 0 ? Math.min(Math.floor(days), PERIOD_DAYS_MAX) : 7;

    const rows = await currentTx().execute<RawRow>(sql`
      SELECT t.tenant_id::text        AS tenant_id,
             t.tenant_name            AS tenant_name,
             t.extraction_template    AS template,
             coalesce(sum(jsonb_array_length(ar.messages)), 0)::int        AS message_count,
             coalesce(sum(jsonb_array_length(ar.records)), 0)::int         AS record_count,
             coalesce(sum(jsonb_array_length(ar.daily_reports)), 0)::int   AS daily_count,
             coalesce(sum(jsonb_array_length(ar.service_reports)), 0)::int AS service_count
        FROM tenants t
        LEFT JOIN analysis_upload au
               ON au.tenant_id = t.tenant_id
              AND au.uploaded_at >= now() - (${d} || ' days')::interval
        LEFT JOIN analysis_result ar ON ar.upload_id = au.id
       GROUP BY t.tenant_id, t.tenant_name, t.extraction_template
       ORDER BY t.tenant_name
    `);

    const out: TenantHealth[] = [];
    for (const r of rows.rows) {
      const template = resolveTemplate(r.template);
      const def = TEMPLATE_REGISTRY[template];
      const [l1, conf] = await Promise.all([
        this.fieldFill(r.tenant_id, d, "records", [...L1_TRACKED_FIELDS], "L1"),
        this.confidenceMix(r.tenant_id, d),
      ]);
      const l2 = def.resultKey && def.trackedFields.length
        ? await this.fieldFill(r.tenant_id, d, def.resultKey, def.trackedFields, "L2")
        : [];

      const templateReportCount = def.resultKey === "service_reports" ? r.service_count : r.daily_count;
      out.push({
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        template,
        templateLabel: def.label,
        messageCount: r.message_count,
        recordCount: r.record_count,
        templateReportCount,
        confidence: conf,
        fields: [...l1, ...l2],
        warnings: buildWarnings({
          template, messageCount: r.message_count, recordCount: r.record_count,
          templateReportCount, hasTemplate: !!def.resultKey, fields: [...l1, ...l2], conf,
        }),
      });
    }
    return { days: d, tenants: out };
  }

  /** 某 jsonb 陣列欄位裡，指定欄位有值的比例 */
  private async fieldFill(
    tenantId: string, days: number, column: string, fields: string[], layer: "L1" | "L2",
  ): Promise<FieldFill[]> {
    if (fields.length === 0) return [];
    // column 來自 TEMPLATE_REGISTRY 常數，非使用者輸入（不可為外部值 · 避免注入）
    const col = column === "records" ? sql`ar.records`
      : column === "service_reports" ? sql`ar.service_reports`
      : sql`ar.daily_reports`;
    const res = await currentTx().execute<{ field: string; filled: number; total: number }>(sql`
      SELECT f.field,
             count(*) FILTER (WHERE nullif(item->>f.field, '') IS NOT NULL)::int AS filled,
             count(*)::int AS total
        FROM analysis_upload au
        JOIN analysis_result ar ON ar.upload_id = au.id,
        LATERAL jsonb_array_elements(${col}) item,
        LATERAL unnest(${sql.raw(`ARRAY[${fields.map((f) => `'${f.replace(/'/g, "''")}'`).join(",")}]`)}) AS f(field)
       WHERE au.tenant_id = ${tenantId}::uuid
         AND au.uploaded_at >= now() - (${days} || ' days')::interval
       GROUP BY f.field
    `);
    const byField = new Map(res.rows.map((x) => [x.field, x]));
    return fields.map((field) => {
      const hit = byField.get(field);
      const total = hit?.total ?? 0;
      const filled = hit?.filled ?? 0;
      return { field, layer, filled, total, rate: total ? Math.round((filled / total) * 100) : 0 };
    });
  }

  private async confidenceMix(tenantId: string, days: number) {
    const res = await currentTx().execute<{ confidence: string; n: number }>(sql`
      SELECT item->>'confidence' AS confidence, count(*)::int AS n
        FROM analysis_upload au
        JOIN analysis_result ar ON ar.upload_id = au.id,
        LATERAL jsonb_array_elements(ar.records) item
       WHERE au.tenant_id = ${tenantId}::uuid
         AND au.uploaded_at >= now() - (${days} || ' days')::interval
       GROUP BY 1
    `);
    const m = { high: 0, medium: 0, low: 0 };
    for (const r of res.rows) {
      if (r.confidence === "high" || r.confidence === "medium" || r.confidence === "low") m[r.confidence] = r.n;
    }
    return m;
  }
}

type RawRow = {
  tenant_id: string; tenant_name: string; template: string | null;
  message_count: number; record_count: number; daily_count: number; service_count: number;
};

// 判讀訊號 · doc §5 表格。門檻寫在這裡，不散落前端。
function buildWarnings(a: {
  template: string; messageCount: number; recordCount: number; templateReportCount: number;
  hasTemplate: boolean; fields: FieldFill[]; conf: { high: number; medium: number; low: number };
}): string[] {
  const w: string[] = [];
  if (a.messageCount === 0) return w;   // 沒資料就不要報警，那是「還沒開始用」不是「壞了」

  const dead = a.fields.filter((f) => f.total >= 10 && f.rate < 10);
  if (dead.length) {
    w.push(`${dead.map((f) => f.field).join("、")} 幾乎抽不到（<10%）· 模板可能不合`);
  }
  if (a.hasTemplate && a.messageCount >= 50 && a.templateReportCount === 0) {
    w.push("套用的業種模板完全沒有產出 · 該客戶的回報格式可能對不上");
  }
  const total = a.conf.high + a.conf.medium + a.conf.low;
  if (total >= 20 && a.conf.high / total < 0.2) {
    w.push(`高信心僅 ${Math.round((a.conf.high / total) * 100)}% · 抽取品質偏低或對話過於零碎`);
  }
  if (a.messageCount >= 100 && a.recordCount === 0) {
    w.push("讀了很多訊息但沒有任何產出 · 該群可能以閒聊為主");
  }
  return w;
}
