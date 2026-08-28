import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { withSystemTx } from "../db/client.js";

/**
 * LIFF Pre-fill 服務 · 方向 8 Zero-Config 核心
 * 給 Alice 打開 LIFF 時 · 從 line_member 撈她的：
 *   - display_name（LINE 名字）
 *   - picture_url
 *   - 常出現的群組（推斷主要群 → 對應部門）
 *
 * 依 employee-line-binding.md §7-quinque.2 Step 3
 */
@Injectable()
export class LiffPrefillService {
  private readonly logger = new Logger(LiffPrefillService.name);

  /**
   * 從 line_member + line_message 推斷 Alice 的候選資訊
   * 若 Alice 從未在群組發訊 · 只在 line_member 有 profile · 也能拿到 display_name
   */
  async pretillCandidates(botId: string, lineUserId: string): Promise<{
    displayName: string | null;
    pictureUrl: string | null;
    candidateGroups: Array<{
      groupId: string;
      displayName: string | null;         // LINE 群名（Alice 熟）
      departmentId: string | null;         // 對應的 aiproot 部門（系統靜默 map）
      departmentName: string | null;
      messageCount: number;
      lastActiveAt: string;
      /**
       * 這個群「選得了部門」嗎。
       * ⚠️ 清單裡會有選不了的群（未分派部門、或被標成公告／測試群）——
       *    那些照樣顯示（員工要看得到自己的全貌），但不可以拿來當部門依據，
       *    否則產出會歸到一個不存在或不對的組織單位（0068 那條註解講的就是這件事）。
       */
      selectable: boolean;
      groupType: string | null;
    }>;
  }> {
    return withSystemTx(async (tx) => {
      // 從 line_member 拉 profile
      const memberRes = await tx.execute<{
        display_name: string | null;
        picture_url: string | null;
      }>(sql`
        SELECT display_name, picture_url
        FROM line_member
        WHERE bot_id = ${botId}::uuid AND user_id = ${lineUserId}
        LIMIT 1
      `);
      const member = memberRes.rows[0];

      // 從 line_message 統計 · 這 user 常在哪些群發訊（近 30 天）
      // JOIN line_group 拿群名 + department_id
      const groupsRes = await tx.execute<{
        group_id: string;
        display_name: string | null;
        department_id: string | null;
        department_name: string | null;
        group_type: string | null;
        message_count: string;
        last_active_at: string;
      }>(sql`
        SELECT lm.group_id,
               lg.display_name,
               lg.department_id::text,
               d.department_name,
               lg.group_type,
               count(*)::text AS message_count,
               max(lm.sent_at)::text AS last_active_at
        FROM line_message lm
        LEFT JOIN line_group lg ON lg.bot_id = lm.bot_id AND lg.group_id = lm.group_id
        LEFT JOIN departments d ON d.department_id = lg.department_id
        WHERE lm.bot_id = ${botId}::uuid
          AND lm.sender_line_id = ${lineUserId}
          AND lm.chat_context = 'group'
          AND lm.sent_at > (now() - interval '30 days')
        GROUP BY lm.group_id, lg.display_name, lg.department_id, d.department_name, lg.group_type
        ORDER BY count(*) DESC
        LIMIT 10
      `);

      return {
        displayName: member?.display_name ?? null,
        pictureUrl: member?.picture_url ?? null,
        candidateGroups: groupsRes.rows.map((r) => ({
          groupId: r.group_id,
          displayName: r.display_name,
          departmentId: r.department_id,
          departmentName: r.department_name,
          messageCount: parseInt(r.message_count, 10),
          lastActiveAt: r.last_active_at,
          groupType: r.group_type,
          // 與 completeLiffBinding 的推斷條件**必須一致** —— 兩邊不同的話，
          // 畫面上可選的群會推不出部門（或反過來），使用者選了卻沒效果。
          selectable: !!r.department_id && r.group_type === "department",
        })),
      };
    });
  }
}
