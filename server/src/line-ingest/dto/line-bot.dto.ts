import { z } from "zod";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LineBotCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  // utility（群組 ID 小幫手）＝平台層工具 bot · 不屬租戶；analysis＝租戶分析 bot
  kind: z.enum(["analysis", "utility"]).default("analysis"),
  tenantId: z.string().regex(uuidRegex).optional(),
  channelId: z.string().trim().max(50).optional(),
  channelSecret: z.string().trim().min(1).max(200),
  channelAccessToken: z.string().trim().min(10).max(500),
  // 0060 · per-bot LIFF（多 provider）· 省略則 fallback 到 env
  liffId: z.string().trim().max(60).optional(),
  loginChannelId: z.string().trim().max(50).optional(),
}).superRefine((v, ctx) => {
  if (v.kind === "analysis" && !v.tenantId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tenantId"], message: "分析 bot 必須選租戶" });
  }
  // 只填 liffId 不填 loginChannelId 的話，token 驗證會退回全域允許清單 ——
  // 那正是「跨 provider 的 token 被默默接受」的破口，所以要求成對填寫。
  if (v.liffId && !v.loginChannelId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loginChannelId"], message: "填了 LIFF ID 就必須填對應的 LINE Login channel ID" });
  }
});

export const LineBotUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  channelId: z.string().trim().max(50).nullable().optional(),
  channelSecret: z.string().trim().min(1).max(200).optional(),
  channelAccessToken: z.string().trim().min(10).max(500).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  tenantId: z.string().regex(uuidRegex).optional(),                      // 遷移 bot 到新租戶
  // 0060 · nullable = 可清空退回 env 預設；undefined = 不動
  liffId: z.string().trim().max(60).nullable().optional(),
  loginChannelId: z.string().trim().max(50).nullable().optional(),
});

export const LineGroupPatchSchema = z.object({
  departmentId: z.string().regex(uuidRegex).nullable().optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
  analyzeEnabled: z.boolean().optional(),
  /** bot 在這個群要不要回話 · 與 analyzeEnabled 是兩件事（0040）*/
  replyEnabled: z.boolean().optional(),
  /**
   * 0059 · 把「已離開的群」移出清單（true=hidden／false=還原成 left）。
   * ⚠️ 只是隱藏不是刪除：歷史 analysis_upload / line_message 靠這一列保留群名。
   *    bot 若重新被加入該群，webhook 收到 join 事件會自動改回 active。
   */
  hidden: z.boolean().optional(),
});

export type LineBotCreateDto = z.infer<typeof LineBotCreateSchema>;
export type LineBotUpdateDto = z.infer<typeof LineBotUpdateSchema>;
export type LineGroupPatchDto = z.infer<typeof LineGroupPatchSchema>;
