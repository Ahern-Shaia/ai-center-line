import { z } from "zod";

export const LabelCreateSchema = z.object({
  uploadId: z.number().int().positive(),
  targetType: z.enum(["classification", "daily_report", "record"]),
  targetId: z.string().min(1).max(50),   // classification=msgId、daily/record=index（stringified for uniform）
  correct: z.boolean(),
  note: z.string().max(1000).optional(),
});

export type LabelCreatePayload = z.infer<typeof LabelCreateSchema>;
