import { z } from "zod";

// 客戶側 Ragic Workflow 送過來的 payload。fields 對應 §5.1 Global Workflow JS。
// 每欄硬限 500 字（LINE 單則訊息上限 5000；留餘裕），string 都要 trim。
const strField = z.string().trim().max(500);

export const RagicMaintenanceReportSchema = z.object({
  trigger: z.enum(["save", "button"]),
  sheetPath: z.string().regex(/^\/[a-z0-9-]+\/\d+$/, "sheetPath 需 /tab/id 格式"),
  recordId: z.number().int().positive().max(1e12),
  record: z.object({
    維修保養單號: strField,
    客戶全稱: strField,
    聯絡人: strField,
    聯絡電話: strField,
    車型: strField,
    車牌號碼: strField,
    維修保養狀況: strField,
    客戶詳細地址: strField,
  }),
});

export type RagicMaintenanceReportPayload = z.infer<typeof RagicMaintenanceReportSchema>;
export type MaintenanceRecord = RagicMaintenanceReportPayload["record"];
