import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { withTenant } from "../db/client.js";

// 導入進度 · 「空狀態當老師」的第二件事
//
// 為什麼是 checklist 而不是導覽 tour：**tour 看完就忘，checklist 會一直在，直到做完**。
// 而且這幾個數字本來就算得出來，不需要任何人工維護或打勾。
//
// ⭐ 第 4 項（綁定率）刻意放進來 —— 那是導入期最該盯的數字：
//    沒綁定的同仁系統認不出是誰 → 他的日報出不來、任務指派不到他、
//    AI 抽到的人名對不上帳號（看板顯示「待認領」）。綁定率上不去，其他功能的價值全部打折。
//    這件事一直只存在於待辦清單裡，把它變成畫面上一直看得到的進度才會有人管。

export interface OnboardingStep {
  key: "departments" | "groups" | "leads" | "binding";
  label: string;
  /** 做到哪 / 目標 · 目標為 null 代表「有就算過」*/
  done: number;
  total: number | null;
  complete: boolean;
  hint: string;
}

@Injectable()
export class OnboardingProgressService {
  async get(tenantId: string): Promise<{ steps: OnboardingStep[]; allDone: boolean }> {
    return withTenant({ tenantId, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
      const r = await tx.execute<{
        depts: number; groups: number; assigned: number;
        leads: number; bound: number; talkers: number;
      }>(sql`
        SELECT
          (SELECT count(*)::int FROM departments d WHERE d.tenant_id = ${tenantId}::uuid) AS depts,
          (SELECT count(*)::int FROM line_group g JOIN line_bot b ON b.bot_id = g.bot_id
             WHERE b.tenant_id = ${tenantId}::uuid AND g.status = 'active') AS groups,
          (SELECT count(*)::int FROM line_group g JOIN line_bot b ON b.bot_id = g.bot_id
             WHERE b.tenant_id = ${tenantId}::uuid AND g.status = 'active'
               AND g.department_id IS NOT NULL) AS assigned,
          (SELECT count(*)::int FROM users u
             WHERE u.tenant_id = ${tenantId}::uuid AND u.role = 'group_owner') AS leads,
          (SELECT count(*)::int FROM user_line_binding ub JOIN line_bot b ON b.bot_id = ub.bot_id
             WHERE b.tenant_id = ${tenantId}::uuid AND ub.status = 'active') AS bound,
          (SELECT count(DISTINCT m.sender_line_id)::int FROM line_message m
             WHERE m.tenant_id = ${tenantId}::uuid AND m.chat_context = 'group'
               AND m.sender_line_id IS NOT NULL) AS talkers
      `);
      const d = r.rows[0];

      const steps: OnboardingStep[] = [
        {
          key: "departments", label: "建立部門",
          done: d.depts, total: null, complete: d.depts > 0,
          hint: "任務、日報、誰看得到什麼，都是照部門切的",
        },
        {
          key: "groups", label: "把 LINE 群組分派到部門",
          done: d.assigned, total: d.groups, complete: d.groups > 0 && d.assigned === d.groups,
          hint: d.groups === 0
            ? "還沒有群組 —— 把機器人加進 LINE 群，首則訊息就會自動註冊"
            : "沒分派到部門的群，它的任務不會出現在任何人的看板上",
        },
        {
          key: "leads", label: "指定部門主管",
          done: d.leads, total: null, complete: d.leads > 0,
          hint: "主管才看得到自己部門的任務看板與日報",
        },
        {
          // ⚠️ 分母是「在群裡講過話的人」不是「員工總數」—— 我們不知道公司有幾個人，
          //    只知道有幾個人在群裡出現過。分母會隨著更多人發言而變大，這是對的。
          key: "binding", label: "同仁綁定 LINE",
          done: d.bound, total: d.talkers,
          // 導入期不可能 100%，8 成就算過關 —— 卡在 100% 會讓這張清單永遠消不掉
          complete: d.talkers > 0 && d.bound >= Math.ceil(d.talkers * 0.8),
          hint: "沒綁定的同仁，系統認不出他是誰 —— 日報出不來、任務也指派不到他",
        },
      ];
      return { steps, allDone: steps.every((s) => s.complete) };
    });
  }
}
