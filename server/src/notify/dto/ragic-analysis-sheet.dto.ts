import { z } from "zod";

// 客戶側 Ragic Workflow 送過來的 payload（TB-P01 分析表）
// 每欄硬限 500 字（LINE 單則訊息上限 5000）、string trim
// 全欄 optional（default ""）：Ragic 空欄或 transition 期不炸
const strField = z.string().trim().max(500).optional().default("");

export const RagicAnalysisSheetSchema = z.object({
  trigger: z.enum(["save", "button"]),
  sheetPath: z.string().regex(/^\/[a-z0-9-]+\/\d+$/, "sheetPath 需 /tab/id 格式"),
  sheetName: strField,
  recordUrl: z.string().trim().url().max(500).optional(),
  timestamp: z.number().int().nonnegative().max(1e14).optional(),
  recordId: z.number().int().nonnegative().max(1e12),
  record: z.object({
    // 分析表 header
    分析表編號: strField,
    狀態: strField,
    // 客戶
    客戶全稱: strField,
    聯絡地址: strField,
    // 訂購單
    訂購單編號: strField,
    訂購單日期: strField,
    // 交期
    預交日期: strField,
    剩餘天數: strField,
    // 部門與稅
    所屬部門: strField,
    課稅類別: strField,
    // 金額
    未稅合計: strField,
    數量合計: strField,
  }),
});

export type RagicAnalysisSheetPayload = z.infer<typeof RagicAnalysisSheetSchema>;
export type AnalysisSheetRecord = RagicAnalysisSheetPayload["record"];
