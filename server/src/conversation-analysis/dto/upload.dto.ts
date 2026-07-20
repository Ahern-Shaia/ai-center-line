import { z } from "zod";

// POST /conversation-analysis/uploads · body 是 JSON、內含 rawContent 字串
// 檔案上限：rawContent 500 KB（實際 fastify body limit 1 MB · 保留 headroom）
export const UploadCreateSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  rawContent: z.string().min(10).max(500_000),
  tenantSlug: z.enum(["twh"]),  // pilot Stage 1 只支援 twh · M6 擴 registry
});

export type UploadCreatePayload = z.infer<typeof UploadCreateSchema>;
