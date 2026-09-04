/**
 * 任務時間 · 抵達與離開配對 · docs/modules/attendance-trip-state-machine.md §5-bis
 *
 * 客戶原話：「打卡需要計算抵達與離開時間，就能計算此次任務完成時間…
 * 每次匹配到抵達與離開為一組就代表這是第一趟任務時間」
 *
 * 【最重要的一條規則：不推估】
 * 沒有 depart_site 的那一站，**不填數字**，標「離開時間未記錄」。
 * 出勤與工時是會被拿來**計酬與稽核**的資料 —— 推估等於造假（F-12 · P0 · R11）。
 * 「用下一次抵達的時間當這一站的離開時間」看起來很合理，那正是 OQ-TDP-7 的丙案，
 * 已裁定**不採**。
 *
 * ⚠️ 這支是純函式、不碰 DB：配對規則是這個功能的全部，要能大量便宜地測。
 */
import type { PunchType } from "./trip-state.js";

export interface PunchPoint {
  punchId: string;
  punchType: PunchType;
  /** epoch ms */
  atMs: number;
  customerName: string | null;
}

export interface TaskStay {
  /** 第幾趟（1 起算）· 客戶說的「第一趟任務時間」 */
  seq: number;
  place: string | null;
  arrivePunchId: string;
  arriveAtMs: number;
  /** null = 這一站沒有記錄離開 */
  departPunchId: string | null;
  departAtMs: number | null;
  /**
   * 停留幾分鐘 · **null = 未記錄離開，不是 0**。
   * ⚠️ 呼叫端不可以 `?? 0` —— 那會讓「不知道」變成「0 分鐘」，
   * 而 0 分鐘是一個看起來很正常、沒有人會去查的數字。
   */
  minutes: number | null;
}

/**
 * 把一天的打卡切成逐趟停留。
 *
 * @param punches 同一人、同一天，**已按時間排序**
 */
export const pairStays = (punches: PunchPoint[]): TaskStay[] => {
  const stays: TaskStay[] = [];
  let seq = 0;

  for (let i = 0; i < punches.length; i++) {
    const p = punches[i];
    if (p.punchType !== "arrive_site") continue;

    seq++;
    // 這一站的離開 = 下一筆「結束這個停留」的打卡。
    //
    // ⚠️ 只認 depart_site 與 clock_out：
    //   · depart_site → 正常離站
    //   · clock_out   → 在客戶端直接收班（很常見：最後一站做完就回家）
    //   · 又一個 arrive_site → **漏打離開**，這一站的時長就是不知道，不可以拿它當離開時間
    let depart: PunchPoint | null = null;
    for (let j = i + 1; j < punches.length; j++) {
      const q = punches[j];
      if (q.punchType === "depart_site" || q.punchType === "clock_out") { depart = q; break; }
      if (q.punchType === "arrive_site" || q.punchType === "clock_in") break;   // 這一站沒記錄離開
    }

    stays.push({
      seq,
      place: p.customerName,
      arrivePunchId: p.punchId,
      arriveAtMs: p.atMs,
      departPunchId: depart?.punchId ?? null,
      departAtMs: depart?.atMs ?? null,
      // ⚠️ 負數代表資料本身有問題（時間倒退）—— 一樣回 null，不要顯示負的分鐘數
      minutes: depart && depart.atMs >= p.atMs
        ? Math.round((depart.atMs - p.atMs) / 60_000)
        : null,
    });
  }

  return stays;
};

/**
 * 今日合計 · **只加總完整的那幾趟**。
 *
 * ⚠️ 一定要同時回 `incomplete`，而且畫面一定要顯示它。
 * 只給「今日任務時間 3 小時 20 分」而不說「另有 2 趟未記錄離開」，
 * 那個數字會被當成全部 —— 使用者不會知道它少算了。
 */
export const summarizeStays = (stays: TaskStay[]): {
  totalMinutes: number;
  completed: number;
  incomplete: number;
} => {
  const done = stays.filter((s) => s.minutes != null);
  return {
    totalMinutes: done.reduce((n, s) => n + (s.minutes ?? 0), 0),
    completed: done.length,
    incomplete: stays.length - done.length,
  };
};
