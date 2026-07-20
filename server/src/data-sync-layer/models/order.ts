import { z } from "zod";

// Canonical Order schema · 對應 docs/modules/data-sync-layer.md §4.1
// Denormalized customer_name（未來加 customer_id 關聯 · pilot 階段 no FK 免 sync 順序問題）
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OrderSchema = z.object({
  tenantId: z.string().regex(uuidPattern, "tenantId 需為 UUID 格式"),
  sourceConnector: z.enum(["ragic", "weyver", "sap", "manual"]),
  sourceRecordId: z.string().min(1).max(200),
  sourceSheetPath: z.string().max(200).optional(),
  orderNo: z.string().min(1).max(100),
  customerName: z.string().max(200).optional(),
  // Date 用 YYYY-MM-DD string · drizzle date type 接受 string
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  expectedDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.string().max(50).optional(),
  amount: z.number().optional().nullable(),
  currency: z.string().length(3).default("TWD"),
  ownerName: z.string().max(100).optional(),
  raw: z.record(z.string(), z.unknown()).default({}),
  writeBackStatus: z.enum(["synced", "pending", "failed"]).default("synced"),
});

export type OrderCanonical = z.infer<typeof OrderSchema>;
