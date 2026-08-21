import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { withTenant } from "../db/client.js";

// 成員的群組活動 · docs/modules/group-type-classification.md §4.6（M3.5）
//
// 用途：在「部門/成員」頁把「所屬部門」的**推導依據**顯示出來 ——
// 他在哪些群發言、各幾則、所以被歸到哪一個。
//
// ⭐ 這支查詢必須跟 employee-binding 的推導**走同一條路**，否則畫面會解釋錯：
//    同樣 join user_line_binding→line_message（不是 line_message.sender_user_id）、
//    同樣 chat_context='group'、同樣近 30 天。差一個條件，顯示的數字就不是
//    當初做決定用的那組數字，而使用者會拿它來質疑為什麼歸錯部門。
//
// ⚠️ **只回「有系統帳號且已綁定」的人**（2026-08-21 用戶裁定範圍）。
//    群裡另外 40 幾個沒帳號的人不在這裡出現 —— 那會把 line_member 的 LINE 暱稱
//    曝露到畫面上，是另一個決定（OQ-GTC-13），不夾帶。

const LOOKBACK_DAYS = 30;

export interface MemberGroupActivity {
  groupName: string;
  groupType: string;
  messageCount: number;
  /** 這個群算不算進部門判定 —— 只有 department 型且有分派部門的才算 */
  countsTowardDepartment: boolean;
}

@Injectable()
export class MemberGroupActivityService {
  /** userId → 該員工近 30 天發言過的群（多到少）· 沒發言的人不會出現在 map 裡 */
  async byUser(tenantId: string): Promise<Record<string, MemberGroupActivity[]>> {
    return withTenant({ tenantId, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
      const res = await tx.execute<{
        user_id: string; group_name: string | null; group_type: string;
        has_dept: boolean; n: number;
      }>(sql`
        SELECT b.user_id::text,
               g.display_name AS group_name,
               g.group_type,
               (g.department_id IS NOT NULL) AS has_dept,
               count(*)::int AS n
        FROM user_line_binding b
        JOIN line_message m ON m.sender_line_id = b.line_user_id AND m.bot_id = b.bot_id
        JOIN line_group g ON g.bot_id = m.bot_id AND g.group_id = m.group_id
        JOIN line_bot bt ON bt.bot_id = g.bot_id
        WHERE bt.tenant_id = ${tenantId}::uuid
          AND b.status = 'active'
          AND m.chat_context = 'group'
          AND m.sent_at > now() - (${LOOKBACK_DAYS} || ' days')::interval
          AND g.status = 'active'
        GROUP BY b.user_id, g.display_name, g.group_type, g.department_id
        ORDER BY count(*) DESC
      `);

      const out: Record<string, MemberGroupActivity[]> = {};
      for (const r of res.rows) {
        (out[r.user_id] ??= []).push({
          groupName: r.group_name ?? "（未命名群組）",
          groupType: r.group_type,
          messageCount: r.n,
          countsTowardDepartment: r.group_type === "department" && r.has_dept,
        });
      }
      return out;
    });
  }
}
