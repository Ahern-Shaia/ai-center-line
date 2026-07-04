import { Injectable } from "@nestjs/common";
import { currentTx } from "../db/client.js";
import { departments, tickets } from "../db/schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;
type Health = "green" | "yellow" | "red";

export interface WarroomGroup {
  department_id: string;
  name: string;
  ragic_table: string;
  health: Health;
  signed_off: boolean;
  today_total: number;
  high_count: number;
  has_low_pending: boolean;
}

// 戰情室聚合。分母一律用 N＝該租戶（RLS 範圍內）實際部門數，非固定 6。
// as_of 取該租戶最新 ticket 時間，讓 demo 假資料的健康度計算穩定可重現。
@Injectable()
export class WarroomService {
  async warroom() {
    const tx = currentTx();
    const depts = await tx.select().from(departments);
    const tks = await tx.select().from(tickets);

    const N = depts.length;
    const times = tks.map((t) => new Date(t.createdAt).getTime());
    const asOfMs = times.length ? Math.max(...times) : Date.now();

    const groups: WarroomGroup[] = depts.map((d) => {
      const dt = tks.filter((t) => t.departmentId === d.departmentId);
      const lastMs = dt.length ? Math.max(...dt.map((t) => new Date(t.createdAt).getTime())) : 0;
      const active = lastMs > 0 && asOfMs - lastMs <= DAY_MS;
      const overdue = dt.some((t) => t.confirmStatus === "逾時警示");
      const hasLow = dt.some((t) => t.confidence === "low" && t.confirmStatus === "待簽核");
      const signed = dt.length > 0 && dt.every((t) => t.confirmStatus === "已簽核");
      const health: Health = overdue || !active ? "red" : hasLow ? "yellow" : "green";
      return {
        department_id: d.departmentId,
        name: d.departmentName,
        ragic_table: d.ragicTable,
        health,
        signed_off: signed,
        today_total: dt.length,
        high_count: dt.filter((t) => t.confidence === "high").length,
        has_low_pending: hasLow,
      };
    });

    const signed = groups.filter((g) => g.signed_off).length;
    const green = groups.filter((g) => g.health === "green").length;
    const labeled = tks.filter((t) => t.confidence !== null);
    const highNum = labeled.filter((t) => t.confidence === "high").length;

    return {
      as_of: new Date(asOfMs).toISOString(),
      dept_count: N,
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
