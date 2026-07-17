import { z } from "zod";

// 客戶側 Ragic Workflow 送過來的 payload（鮮勇原料驗貨單「上游-4a」）
// 每欄硬限 500 字（LINE 單則訊息上限 5000）、string trim
// 全欄 optional（default ""）：Ragic 空欄或 transition 期不炸
// 8 欄全上（compose 全輸出；OQ-NMT-8 建議）
const strField = z.string().trim().max(500).optional().default("");

export const RagicMaterialInspectionSchema = z.object({
  trigger: z.enum(["save", "button"]),
  sheetPath: z.string().regex(/^\/[a-z0-9-]+\/\d+$/, "sheetPath 需 /tab/id 格式"),
  sheetName: strField,
  recordUrl: z.string().trim().url().max(500).optional(),
  timestamp: z.number().int().nonnegative().max(1e14).optional(),
  recordId: z.number().int().nonnegative().max(1e12),
  record: z.object({
    品項名稱: strField,           // 1018491
    品編: strField,               // 1018574
    批號: strField,               // 1018604
    收貨數量: strField,           // 1018494
    數量: strField,               // 1018572
    單位: strField,               // 1018495
    製造有效日期: strField,       // 1018597（原欄名「製造 / 有效日期」；JS key 避 `/`）
    檢驗完成: strField,           // 1023030（原欄名「檢驗完成？」；JS key 避 `?`）
  }),
});

export type RagicMaterialInspectionPayload = z.infer<typeof RagicMaterialInspectionSchema>;
export type MaterialInspectionRecord = RagicMaterialInspectionPayload["record"];
