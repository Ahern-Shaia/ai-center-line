import { z } from "zod";

// 自服務改顯示名稱 · 只改自己那一列的 display_name（純外觀欄位，無提權）
export const DisplayNameSchema = z.object({
  displayName: z.string().trim().min(1, "名稱不可空白").max(50, "名稱過長"),
});
export type DisplayNameDto = z.infer<typeof DisplayNameSchema>;
