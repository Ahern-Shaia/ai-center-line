import { z } from "zod";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LineBotCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  tenantId: z.string().regex(uuidRegex),
  channelId: z.string().trim().max(50).optional(),
  channelSecret: z.string().trim().min(1).max(200),
  channelAccessToken: z.string().trim().min(10).max(500),
});

export const LineBotUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  channelId: z.string().trim().max(50).nullable().optional(),
  channelSecret: z.string().trim().min(1).max(200).optional(),
  channelAccessToken: z.string().trim().min(10).max(500).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  tenantId: z.string().regex(uuidRegex).optional(),                      // 遷移 bot 到新租戶
});

export const LineGroupPatchSchema = z.object({
  departmentId: z.string().regex(uuidRegex).nullable().optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
  analyzeEnabled: z.boolean().optional(),
  /** bot 在這個群要不要回話 · 與 analyzeEnabled 是兩件事（0040）*/
  replyEnabled: z.boolean().optional(),
});

export type LineBotCreateDto = z.infer<typeof LineBotCreateSchema>;
export type LineBotUpdateDto = z.infer<typeof LineBotUpdateSchema>;
export type LineGroupPatchDto = z.infer<typeof LineGroupPatchSchema>;
