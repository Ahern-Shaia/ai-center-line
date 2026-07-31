import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { currentTx, withSystemTx, withTenant } from "../db/client.js";
import { LlmConfigService } from "../llm/llm-config.service.js";
import { createLLMProvider } from "../llm/provider.factory.js";
import { defaultAnthropicProvider } from "../conversation-analysis/pipeline/index.js";
import type { LLMProvider } from "../llm/provider.interface.js";
import { PersonalDailyReportRepository, type PersonalDailyReportItem } from "./personal-daily-report.repository.js";

// 個人日報 pipeline schema · 精簡 · 只要 items array
const PersonalReportSchema = z.object({
  items: z.array(z.object({
    time: z.string().nullable(),          // "08:30" or "08:30-10:00" 或 null
    title: z.string(),
    detail: z.string().nullable(),
    followup: z.string().nullable(),
  })),
});

const PERSONAL_SYSTEM_PROMPT = `你是專業日報整理助手。

你會收到某員工「當日私訊工作 bot 的所有訊息」·這些訊息內容散亂 (吃飯前打幾則 · 開會後補一則 · 事情做完想到什麼就發)。

請將它們整理成一份**結構化的個人工作日報**。

整理原則：
1. 依訊息時間排序，最早的在前
2. 同一件事(例：一場會議、一個客戶接洽)的多則訊息 · 合併為**一項**
3. 若訊息含時間戳(「8:30 進廠」)· 用該時間；若含時段(「開會 9-11」)· time 填「9:00-11:00」
4. title 用簡短句 (10-20 字)
5. detail 填該項的細節：討論了什麼、結論、數據
6. 追蹤事項 (「明日 09:00 跟人資申請 2 名」)填 followup
7. 保持員工原意 · 不添加主觀評論
8. 若訊息只是打招呼 / 閒聊 / 系統轉發 · 略過

輸出 JSON:
{
  "items": [
    { "time": "08:30-10:00", "title": "A 客戶 Q3 交期討論", "detail": "客戶要求提早 15 天...", "followup": "明日 09:00 跟人資申請 2 名檢驗" },
    { "time": "12:30", "title": "內部品保確認", "detail": "...", "followup": null }
  ]
}
`;

/**
 * PersonalDailyReportService · PDR-M2
 * 對照 docs/modules/personal-daily-report.md §5
 *
 * generate(userId, reportDate)：
 *   1. 拉當日 chat_context='personal' 訊息 (RLS + user_id filter)
 *   2. 空 → markEmpty (OQ-PDR-4 A · 不 penalize)
 *   3. 拼 blob → LLM personal template → items[]
 *   4. UPSERT personal_daily_report (draft)
 */
@Injectable()
export class PersonalDailyReportService {
  private readonly logger = new Logger(PersonalDailyReportService.name);

  constructor(
    private readonly repo: PersonalDailyReportRepository,
    private readonly llmConfig: LlmConfigService,
  ) {}

  async generate(args: {
    tenantId: string;
    userId: string;
    reportDate: string;              // "YYYY-MM-DD" 台北時區
  }): Promise<{
    reportId: string | null;
    status: "completed" | "empty" | "failed";
    itemCount: number;
    errorMessage?: string;
  }> {
    try {
      // Step 1 · 拉當日訊息 (walked with tenant_admin role 才能對 line_message + users 都通)
      const messages = await withTenant({ tenantId: args.tenantId, role: "tenant_admin" }, (tx) => tx.execute<{
        message_id: string;
        text_content: string | null;
        sent_at: string;
        user_display_name: string;
      }>(sql`
        SELECT lm.message_id,
               lm.text_content,
               lm.sent_at::text,
               u.display_name AS user_display_name
        FROM line_message lm
        JOIN users u ON u.user_id = lm.sender_user_id
        WHERE lm.sender_user_id = ${args.userId}::uuid
          AND lm.chat_context = 'personal'
          AND lm.message_type = 'text'
          AND (lm.sent_at AT TIME ZONE 'Asia/Taipei')::date = ${args.reportDate}::date
        ORDER BY lm.sent_at ASC
      `));

      const rows = messages.rows;
      const userDisplayName = rows[0]?.user_display_name ?? "員工";

      // Step 2 · 空日報處理 (OQ-PDR-4 A)
      if (rows.length === 0) {
        await withTenant({ tenantId: args.tenantId, role: "tenant_admin" }, (tx) => this.repo.markEmpty(tx, {
          tenantId: args.tenantId,
          userId: args.userId,
          reportDate: args.reportDate,
        }));
        return { reportId: null, status: "empty", itemCount: 0 };
      }

      // Step 3 · LLM 生成
      const provider = await this.resolveProvider(args.tenantId);
      const blob = rows
        .map((m) => `[${formatTaipeiTime(m.sent_at)}] ${m.text_content?.replace(/\n/g, " ⏎ ") ?? ""}`)
        .join("\n");
      const output = await provider.chat({
        systemPrompt: PERSONAL_SYSTEM_PROMPT,
        cacheableContext: "",       // personal report 無跨 tenant 主檔 · 不用 cache
        userMessage: `員工姓名：${userDisplayName}\n日期：${args.reportDate}\n\n以下是 ${rows.length} 則訊息：\n${blob}`,
        outputSchema: PersonalReportSchema,
      });
      const items = (output.parsed as { items: PersonalDailyReportItem[] }).items;

      // Step 4 · UPSERT draft
      const { reportId } = await withTenant({ tenantId: args.tenantId, role: "tenant_admin" }, (tx) => this.repo.upsertDraft(tx, {
        tenantId: args.tenantId,
        userId: args.userId,
        reportDate: args.reportDate,
        uploadId: null,   // 未走 analysis_upload · 直接 personal pipeline
        aiItems: items.map((i) => ({
          time: i.time ?? undefined,
          title: i.title,
          detail: i.detail ?? undefined,
          followup: i.followup ?? undefined,
        })),
        messageCount: rows.length,
      }));

      this.logger.log(`PDR generated · user=${args.userId} date=${args.reportDate} items=${items.length} messages=${rows.length}`);
      return { reportId, status: "completed", itemCount: items.length };
    } catch (err) {
      const errMsg = (err as Error).message ?? String(err);
      this.logger.error(`PDR failed · user=${args.userId} date=${args.reportDate} · ${errMsg}`);
      try {
        await withTenant({ tenantId: args.tenantId, role: "tenant_admin" }, (tx) => this.repo.markFailed(tx, {
          tenantId: args.tenantId,
          userId: args.userId,
          reportDate: args.reportDate,
          errorMessage: errMsg.slice(0, 500),
        }));
      } catch { /* 若連 markFailed 都掛 · 靜默 */ }
      return { reportId: null, status: "failed", itemCount: 0, errorMessage: errMsg };
    }
  }

  /**
   * 指派任務的原始對話 · 部門制 gate（F-3 修訂 · docs/modules/task-to-personal-report.md §6）
   *
   * F-3 原本一律只給 summary（怕任務來自本人不在的群 → 洩漏）。改成：**任務屬本人部門才給**，
   * 跨部門仍擋。沿用系統既有的部門隱私邊界（tickets RLS 也按部門），一致而非另立一套。
   *
   * 三道護欄（app 層明驗，不靠 RLS 靜默）：讀不到 ticket → 404；assignee≠本人 → 403；
   * ticket 部門≠本人部門 → 403。通過才 withSystemTx 讀 analysis_result（無 RLS）組來源。
   */
  async assignedTaskSource(userId: string, departmentId: string | null, ticketId: string): Promise<{
    summary: string;
    extracted: Record<string, unknown> | null;
    messages: Array<{ id: number; time: string; sender: string; text: string; kind: string; media: { mediaId: string; kind: string } | null }>;
    hasSourceLink: boolean;
    unavailableReason: string | null;
  }> {
    const tx = currentTx();
    const t = await tx.execute<{
      summary: string; department_id: string | null; assignee_user_id: string | null;
      source_upload_id: number | null; source_record_index: number | null; source_message_ids: string[] | null;
    }>(sql`
      SELECT summary, department_id::text, assignee_user_id::text,
             source_upload_id, source_record_index, source_message_ids
      FROM tickets WHERE ticket_id = ${ticketId}::uuid LIMIT 1
    `);
    const ticket = t.rows[0];
    if (!ticket) throw new NotFoundException("找不到這張任務，或你沒有權限查看");
    if (ticket.assignee_user_id !== userId) throw new ForbiddenException("這不是指派給你的任務");
    if (!departmentId || ticket.department_id !== departmentId) {
      throw new ForbiddenException("這項任務來自其他部門 · 為保護隱私不提供原始對話 · 需要時請洽主管");
    }

    const hasSourceLink = (ticket.source_message_ids?.length ?? 0) > 0;
    const empty = (reason: string | null) => ({
      summary: ticket.summary, extracted: null, messages: [], hasSourceLink, unavailableReason: reason,
    });
    if (ticket.source_upload_id == null || ticket.source_record_index == null) {
      return empty("這張任務沒有對應的來源分析（可能是手動建立，或來源分析已被刪除）");
    }
    const uploadId = ticket.source_upload_id;
    const recordIndex = ticket.source_record_index;

    // analysis_result 無 RLS · 前面已用部門 gate 授權過
    const r = await withSystemTx((stx) => stx.execute<{ messages: unknown; records: unknown }>(sql`
      SELECT messages, records FROM analysis_result WHERE upload_id = ${uploadId}
    `));
    const arow = r.rows[0];
    if (!arow) return empty("來源分析結果已不存在");
    const records = (arow.records as Array<Record<string, unknown>> | null) ?? [];
    const rec = records[recordIndex];
    if (!rec) return empty("來源分析結果的內容已變動，對不到原本那一筆");

    const sourceIds = new Set((rec.source_ids as number[] | undefined) ?? []);
    const all = (arow.messages as Array<{ id: number; time: string; sender: string; text: string; kind: string }> | null) ?? [];
    const picked = all.filter((m) => sourceIds.has(m.id));

    // 照片掛回它自己那一則（比照任務看板 attachMedia）
    const media = await withSystemTx((stx) => stx.execute<{ idx: number; media_id: string; media_type: string }>(sql`
      WITH idmap AS (
        SELECT generate_subscripts(source_message_ids, 1) - 1 AS idx, unnest(source_message_ids) AS message_id
          FROM analysis_upload WHERE id = ${uploadId}
      )
      SELECT idmap.idx, md.media_id::text, md.media_type
        FROM idmap JOIN line_media md ON md.message_id = idmap.message_id AND md.deleted_at IS NULL
    `));
    const byIdx = new Map(media.rows.map((x) => [Number(x.idx), { mediaId: x.media_id, kind: x.media_type }]));
    const messages = picked.map((m) => ({ ...m, media: byIdx.get(m.id) ?? null }));

    return {
      summary: ticket.summary,
      extracted: rec,
      messages,
      hasSourceLink,
      unavailableReason: sourceIds.size > 0 && messages.length === 0
        ? "這筆抽取有標記來源訊息，但在分析結果中找不到對應內容" : null,
    };
  }

  private async resolveProvider(tenantId: string): Promise<LLMProvider> {
    const cfg = await this.llmConfig.getForRuntime(tenantId);
    if (cfg) {
      return createLLMProvider({
        provider: cfg.provider,
        model: cfg.model,
        apiKey: cfg.apiKey,
      });
    }
    return defaultAnthropicProvider();
  }
}

function formatTaipeiTime(iso: string): string {
  // "2026-07-23 08:30:00+08" → "08:30"
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei" });
}
