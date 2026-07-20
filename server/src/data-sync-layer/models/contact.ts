import { z } from "zod";

// Canonical Contact schema · 對應 docs/modules/data-sync-layer.md §4.2
// customer_id FK 用 uuid string · 由 upsert 邏輯決定何時 resolve
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ContactSchema = z.object({
  tenantId: z.string().regex(uuidPattern, "tenantId 需為 UUID 格式"),
  sourceConnector: z.enum(["ragic", "weyver", "sap", "manual"]),
  sourceRecordId: z.string().min(1).max(200),
  customerId: z.string().regex(uuidPattern, "customerId 需為 UUID 格式").optional().nullable(),
  name: z.string().min(1).max(200),
  title: z.string().max(100).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  lineId: z.string().max(100).optional(),           // LINE User ID · CRM 綁定
  raw: z.record(z.string(), z.unknown()).default({}),
});

export type ContactCanonical = z.infer<typeof ContactSchema>;
