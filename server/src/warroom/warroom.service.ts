import { Injectable } from "@nestjs/common";
import { inArray, sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";
import { departments, tickets, users } from "../db/schema.js";
import { inSignoffScope } from "../warroom-task-board/ticket-lane.js";

const DAY_MS = 24 * 60 * 60 * 1000;
type Health = "green" | "yellow" | "red";

export interface WarroomTicket {
  ticket_id: string;
  summary: string;
  confidence: "high" | "medium" | "low" | null;
  needs_review: boolean;
  status: "待簽核" | "已簽核" | "逾時警示";
}

export interface WarroomGroup {
  department_id: string;
  name: string;
  ragic_table: string;
  health: Health;
  signed_off: boolean;
  today_total: number;
  high_count: number;
  has_low_pending: boolean;
  // 已簽核部門顯示：最後簽核者+時間（未簽核為 null）
  signed_by_name: string | null;
  signed_at: string | null;
  // 本日 tickets 摘要（供就地展開）
  today_tickets: WarroomTicket[];
}

// 戰情室聚合。分母一律用 N＝該租戶（RLS 範圍內）實際部門數，非固定 6。
// as_of 取該租戶最新 ticket 時間，讓 demo 假資料的健康度計算穩定可重現。
@Injectable()
export class WarroomService {
  async warroom() {
    const tx = currentTx();
    const allDepts = await tx.select().from(departments);
    const tks = await tx.select().from(tickets);

    // 0068 · 分母排除「不是組織單位」的部門（group-type-classification.md §4.2）
    //
    // ⚠️ 這裡才是分母的真正所在 —— 不是群組數，是 departments.length。
    //    只把群標成 announcement／process **不會**讓分母變小，因為那個部門仍然存在
    //    （而且必須存在：tickets.department_id 是 NOT NULL，那些群的任務要有地方掛）。
    //
    // 判準：一個部門若**有群、但一個 department 型的都沒有**，它就只是
    //      「裝跨部門群任務的容器」，不是組織單位 → 不進健康度與簽核率分母。
    //      完全沒有群的部門仍算（那是導入還沒做完，不是分類錯）。
    const gt = await tx.execute<{ department_id: string; has_dept_group: boolean }>(sql`
      SELECT lg.department_id::text AS department_id,
             bool_or(lg.group_type = 'department') AS has_dept_group
      FROM line_group lg JOIN line_bot b ON b.bot_id = lg.bot_id
      WHERE lg.status = 'active' AND lg.department_id IS NOT NULL
      GROUP BY lg.department_id
    `);
    const hasDeptGroup = new Map(gt.rows.map((r) => [r.department_id, r.has_dept_group]));
    const depts = allDepts.filter((d) => hasDeptGroup.get(d.departmentId) !== false);

    // 抓已簽核者 display_name（一次撈，避免 N+1）
    const signerIds = [...new Set(tks.map((t) => t.confirmedBy).filter((x): x is string => !!x))];
    const signerRows = signerIds.length
      ? await tx.select({ userId: users.userId, displayName: users.displayName, email: users.email }).from(users).where(inArray(users.userId, signerIds))
      : [];
    const signerById = new Map(
      signerRows.map((r) => [r.userId, r.displayName ?? (r.email ? r.email.split("@")[0] : "未知")]),
    );

    const N = depts.length;
    const times = tks.map((t) => new Date(t.createdAt).getTime());
    const asOfMs = times.length ? Math.max(...times) : Date.now();

    const groups: WarroomGroup[] = depts.map((d) => {
      // ⚠️ 只算「在簽核佇列裡的票」。待確認（還沒決定是不是任務）、已忽略、存查（公告／已完成）
      //    都不該進簽核率——它們永遠不會變成「已簽核」，混進來的話 every() 永遠 false，
      //    每個部門都簽不完，簽核率會卡在 0%（task-materialization-gate.md §4 · F-2 P0）
      const dt = tks.filter((t) => t.departmentId === d.departmentId && inSignoffScope(t.confirmStatus));
      const lastMs = dt.length ? Math.max(...dt.map((t) => new Date(t.createdAt).getTime())) : 0;
      const active = lastMs > 0 && asOfMs - lastMs <= DAY_MS;
      const overdue = dt.some((t) => t.confirmStatus === "逾時警示");
      const hasLow = dt.some((t) => t.confidence === "low" && t.confirmStatus === "待簽核");
      const signed = dt.length > 0 && dt.every((t) => t.confirmStatus === "已簽核");
      const health: Health = overdue || !active ? "red" : hasLow ? "yellow" : "green";

      // 已簽核部門：找出最新 confirmed_at 的 ticket，取其簽核者+時間
      let signedByName: string | null = null;
      let signedAt: string | null = null;
      if (signed) {
        const signedTks = dt.filter((t) => t.confirmedAt).sort(
          (a, b) => new Date(b.confirmedAt!).getTime() - new Date(a.confirmedAt!).getTime()
        );
        const latest = signedTks[0];
        if (latest) {
          signedAt = new Date(latest.confirmedAt!).toISOString();
          signedByName = latest.confirmedBy ? signerById.get(latest.confirmedBy) ?? null : null;
        }
      }

      return {
        department_id: d.departmentId,
        name: d.departmentName,
        ragic_table: d.ragicTable,
        health,
        signed_off: signed,
        today_total: dt.length,
        high_count: dt.filter((t) => t.confidence === "high").length,
        has_low_pending: hasLow,
        signed_by_name: signedByName,
        signed_at: signedAt,
        today_tickets: dt
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          .map<WarroomTicket>((t) => ({
            ticket_id: t.ticketId,
            summary: t.summary ?? "",
            confidence: t.confidence,
            needs_review: t.needsReview,
            status: t.confirmStatus as WarroomTicket["status"],
          })),
      };
    });

    const signed = groups.filter((g) => g.signed_off).length;
    const green = groups.filter((g) => g.health === "green").length;
    const labeled = tks.filter((t) => t.confidence !== null);
    const highNum = labeled.filter((t) => t.confidence === "high").length;

    return {
      as_of: new Date(asOfMs).toISOString(),
      dept_count: N,
      /** 0068 · 被排除的部門數（只裝跨部門群、不是組織單位）· 前端在分母旁說明用 */
      excluded_depts: allDepts.length - N,
      signoff_rate: N ? signed / N : 0,
      signed_depts: signed,
      health_rate: N ? green / N : 0,
      green_depts: green,
      high_conf_ratio: labeled.length ? highNum / labeled.length : 0,
      high_num: highNum,
      high_den: labeled.length,
      groups,
    };
  }
}
