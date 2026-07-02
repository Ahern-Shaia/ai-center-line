import type { Aggregate, GroupStatus, Health, Ticket, WarRoomData } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function ticketsOf(data: WarRoomData, deptId: string): Ticket[] {
  return data.tickets.filter((t) => t.department_id === deptId);
}

/**
 * 由 tickets 計算戰情室聚合指標。公式取自委員問答準備文件（設計鐵律，可當場反推）：
 *  - 簽核完成率 = 已簽核群組 ÷ 6
 *  - 健康度     = 綠燈群組 ÷ 6（綠=24h內活動且未逾時且無低信心待補）
 *  - 高信心比例 = high 筆數 ÷ 當日已標信心度總數
 */
export function computeAggregate(data: WarRoomData, asOf: string): Aggregate {
  const asOfMs = new Date(asOf).getTime();
  const groups: GroupStatus[] = data.departments.map((dept) => {
    const dt = ticketsOf(data, dept.department_id);
    const activeWithin24h = asOfMs - new Date(dept.last_activity).getTime() <= DAY_MS;
    const overdue = dt.some((t) => t.confirm_status === "逾時警示");
    const hasLowPending = dt.some(
      (t) => t.confidence === "low" && t.confirm_status === "待簽核",
    );
    // 已簽核：該群組當日有草稿且全部已簽核
    const signedOff = dt.length > 0 && dt.every((t) => t.confirm_status === "已簽核");

    let health: Health;
    if (overdue || !activeWithin24h) health = "red";
    else if (hasLowPending) health = "yellow";
    else health = "green";

    return {
      department: dept,
      health,
      signed_off: signedOff,
      today_total: dt.length,
      high_count: dt.filter((t) => t.confidence === "high").length,
      has_low_pending: hasLowPending,
      active_within_24h: activeWithin24h,
    };
  });

  const signedGroups = groups.filter((g) => g.signed_off).length;
  const greenGroups = groups.filter((g) => g.health === "green").length;
  const total = data.departments.length; // 6

  const labeled = data.tickets.filter((t) => t.confidence !== null);
  const highNum = labeled.filter((t) => t.confidence === "high").length;
  const highDen = labeled.length;

  return {
    as_of: asOf,
    signoff_rate: signedGroups / total,
    signed_groups: signedGroups,
    health_rate: greenGroups / total,
    green_groups: greenGroups,
    high_conf_ratio: highDen === 0 ? 0 : highNum / highDen,
    high_conf_num: highNum,
    high_conf_den: highDen,
    groups,
    metrics: data.metrics,
  };
}

export const pct = (r: number): number => Math.round(r * 100);
