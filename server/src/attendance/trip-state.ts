/**
 * 外勤打卡狀態機 · docs/modules/attendance-trip-state-machine.md §4
 *
 * 【為什麼要有這支】
 * 現行前端用「今天打過幾次卡」去猜現在該顯示什麼按鈕（`PunchView.tsx`）。
 * 那在只有兩個型別時剛好對；加入 `depart_site` 之後會**推錯**，
 * 而且錯的方式是安靜的 —— 按鈕顯示成別的動作，人照按，資料就歪了。
 *
 * 所以狀態改成由**最後一次打卡的型別**唯一決定，並且集中在這一支：
 * 後端驗證與前端顯示吃同一份判斷，不會有兩套規則各自漂移。
 *
 * ⚠️ 這支刻意是**純函式、不碰 DB**：
 *   ① 它是 P0 守門（哪些動作允許）的依據，要能大量、便宜地測
 *   ② 「今天」的邊界由呼叫端決定（台北日），這裡不重新實作一次時區
 */

/** 今天還沒打卡 / 在路上 / 在某一站 / 今日行程已結束 */
export type TripState = "not_started" | "moving" | "at_site" | "ended";

export type PunchType = "clock_in" | "arrive_site" | "depart_site" | "clock_out";

export const PUNCH_TYPES: readonly PunchType[] = [
  "clock_in", "arrive_site", "depart_site", "clock_out",
];

/**
 * 由「今天最後一次打卡的型別」決定現在的狀態。
 *
 * ⚠️ 只看最後一筆就夠 —— 狀態機的每個轉移都是全決定的，
 * 不需要回放整天。回放反而會讓「補打卡」之後的狀態難以預期。
 *
 * @param lastPunchType 今天最後一次打卡；null = 今天還沒打過
 */
export const resolveState = (lastPunchType: PunchType | null): TripState => {
  switch (lastPunchType) {
    case null:
    case undefined:
      return "not_started";
    case "clock_in":
      return "moving";        // 出發了，還沒到第一站
    case "arrive_site":
      return "at_site";       // 在某一站上
    case "depart_site":
      return "moving";        // 離站了，前往下一站 —— 跟 clock_in 同一個狀態
    case "clock_out":
      return "ended";
    default:
      // ⚠️ 不認得的型別**不要猜**。回 not_started 會讓畫面出現「開始外勤」，
      //    他按下去就多一筆 clock_in，把資料弄得更亂。
      throw new Error(`未知的打卡型別：${String(lastPunchType)}`);
  }
};

/**
 * 每個狀態下**允許**的動作 · §4.1 的轉移表，反過來寫。
 *
 * ⚠️ 「今日行程結束」(`clock_out`) 在 moving 與 at_site 都允許 ——
 * 那是逃生門，不能只在某一個狀態才摸得到（§4.2）。
 */
export const allowedActions = (state: TripState): PunchType[] => {
  switch (state) {
    case "not_started": return ["clock_in"];
    case "moving":      return ["arrive_site", "clock_out"];
    case "at_site":     return ["depart_site", "clock_out"];
    // 已結束還能「繼續外勤」—— 業務下午又被叫出去是常態，
    // 不給這條路的話他只能等明天，或者去補一筆假的
    case "ended":       return ["clock_in"];
  }
};

/** 該狀態下的**主**動作（畫面上唯一那顆大按鈕 · §4.2）· ended 沒有主按鈕 */
export const primaryAction = (state: TripState): PunchType | null => {
  switch (state) {
    case "not_started": return "clock_in";
    case "moving":      return "arrive_site";
    case "at_site":     return "depart_site";
    case "ended":       return null;      // 顯示今日總結，「繼續外勤」是次要位階
  }
};

export const isAllowed = (state: TripState, action: PunchType): boolean =>
  allowedActions(state).includes(action);
