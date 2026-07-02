import { z } from "zod";

export const CategoryEnum = z.enum([
  "daily_report", // 報工日報
  "attendance", // 出勤異動
  "maintenance", // 維保異常
  "rnd", // 研發討論
  "procurement", // 採購
  "chitchat", // 閒聊
]);
export type Category = z.infer<typeof CategoryEnum>;

const Confidence = z.enum(["high", "medium", "low"]);

export const AnalysisResult = z.object({
  classifications: z.array(
    z.object({
      id: z.number(),
      category: CategoryEnum,
      confidence: Confidence,
    }),
  ),
  daily_reports: z.array(
    z.object({
      date: z.string().nullable(),
      reporter_name: z.string().nullable(),
      reporter_code: z.string().nullable(),
      line: z.string().nullable(),
      machine_code: z.string().nullable(),
      work_order: z.string().nullable(),
      output_qty: z.number().nullable(),
      defect_qty: z.number().nullable(),
      work_hours: z.number().nullable(),
      overtime_hours: z.number().nullable(),
      issues: z.string().nullable(),
      source_ids: z.array(z.number()),
      confidence: Confidence,
    }),
  ),
  records: z.array(
    z.object({
      category: CategoryEnum,
      title: z.string(),
      detail: z.string(),
      status: z.enum(["open", "in_progress", "resolved", "info"]).nullable(),
      person: z.string().nullable(),
      machine_code: z.string().nullable(),
      work_order: z.string().nullable(),
      source_ids: z.array(z.number()),
      confidence: Confidence,
    }),
  ),
});

export type AnalysisResultT = z.infer<typeof AnalysisResult>;
