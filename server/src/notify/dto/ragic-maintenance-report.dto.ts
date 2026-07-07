import { z } from "zod";

// 客戶側 Ragic Workflow 送過來的 payload。fields 對應 docs/sop/ragic-workflow-templates/tbp71-*.js
// 每欄硬限 500 字（LINE 單則訊息上限 5000；留餘裕），string 都要 trim。
// 全欄 optional（default ""）：Ragic Workflow 有時實體欄位是空的、或部分部署 transition 期
// composer 端統一顯示「（未填）」。
const strField = z.string().trim().max(500).optional().default("");

export const RagicMaintenanceReportSchema = z.object({
  trigger: z.enum(["save", "button"]),
  sheetPath: z.string().regex(/^\/[a-z0-9-]+\/\d+$/, "sheetPath 需 /tab/id 格式"),
  recordId: z.number().int().nonnegative().max(1e12),
  record: z.object({
    // 單據 header
    單據編號: strField,
    單據日期: strField,
    來源別: strField,
    來源單據編號: strField,
    // 車輛
    車型: strField,
    車牌號碼: strField,
    車身號碼: strField,
    產品序號: strField,
    出廠日期: strField,
    // 設備
    設備類型: strField,
    設備型號: strField,
    設備序號: strField,
    // 狀況
    維修保養狀況: strField,
    // 人員
    維修人員編號: strField,
    維修人員姓名: strField,
    經辦人員簽名: strField,
  }),
});

export type RagicMaintenanceReportPayload = z.infer<typeof RagicMaintenanceReportSchema>;
export type MaintenanceRecord = RagicMaintenanceReportPayload["record"];
