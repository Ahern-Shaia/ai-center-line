import { z } from "zod";

// Canonical Customer schema · 對應 docs/modules/data-sync-layer.md §4
// Connector 拉 raw → normalize to this shape → 存 data_sync_customer 表
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CustomerSchema = z.object({
  tenantId: z.string().regex(uuidPattern, "tenantId 需為 UUID 格式"),
  sourceConnector: z.enum(["ragic", "weyver", "sap", "manual"]),
  sourceRecordId: z.string().min(1).max(200),
  sourceSheetPath: z.string().max(200).optional(),
  name: z.string().min(1).max(200),
  code: z.string().max(50).optional(),
  category: z.string().max(20).optional(),        // e.g. 'A' 'B' 'C' 'E'（SAM 分級）
  contactEmail: z.string().max(200).optional(),
  contactPhone: z.string().max(50).optional(),
  raw: z.record(z.string(), z.unknown()).default({}),
});

export type CustomerCanonical = z.infer<typeof CustomerSchema>;
