import { z } from "zod";

// 客戶側 Ragic Workflow 送過來的 payload（鮮勇報價單「下游-1」）
// 每欄硬限 500 字（LINE 單則訊息上限 5000）、string trim
// 全欄 optional（default ""）：Ragic 空欄或 transition 期不炸
// DTO 全 14 欄收，compose 只輸出 8 欄（見 compose-quotation.ts）；未來加欄不改 Workflow JS
const strField = z.string().trim().max(500).optional().default("");

export const RagicQuotationSchema = z.object({
  trigger: z.enum(["save", "button"]),
  sheetPath: z.string().regex(/^\/[a-z0-9-]+\/\d+$/, "sheetPath 需 /tab/id 格式"),
  sheetName: strField,
  recordUrl: z.string().trim().url().max(500).optional(),
  timestamp: z.number().int().nonnegative().max(1e14).optional(),
  recordId: z.number().int().nonnegative().max(1e12),
  record: z.object({
    // header / 狀態
    報價單號: strField,          // 1016153
    單據狀態: strField,          // 1026328
    日期狀態: strField,          // 1026329
    Approval_status: strField,   // 1026332（Approval status → JS 端 key 用底線避空白）
    // 客戶
    客戶名稱: strField,          // 1016085
    // 日期
    報價單日期: strField,        // 1026478
    報價有效日期: strField,      // 1016086
    // 人員
    承辦人員: strField,          // 1016089
    簽核人: strField,            // 1026476
    // 簽核細節（compose 端不輸出、保留給未來擴充）
    簽核開始的日期時間: strField, // 1026472
    簽核結束的日期時間: strField, // 1026473
    送出簽核人: strField,        // 1026474
    送出簽核人姓名: strField,    // 1026475
    // 附件
    下載: strField,              // 1026488
  }),
});

export type RagicQuotationPayload = z.infer<typeof RagicQuotationSchema>;
export type QuotationRecord = RagicQuotationPayload["record"];
