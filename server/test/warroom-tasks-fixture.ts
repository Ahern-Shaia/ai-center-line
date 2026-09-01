/**
 * 建 `WarroomTasksService` 給「不測通知」的測試用。
 *
 * 起因：2026-09-01 把 test/ 納入型別檢查，發現五支測試都寫
 *   `new WarroomTasksService(new TaskConfigService())` —— **少傳第二個依賴**。
 * 執行時 `this.assignNotify` 是 undefined，測試照樣全綠，因為它們只讀看板、
 * 沒走到指派那條路。tsx 剝型別不檢查，所以這個漂移一直沒人發現。
 *
 * ⚠️ 這裡**刻意不給 no-op stub**。給 no-op 的話，哪天有人在這些測試裡加一段
 *    「指派後應該要通知」，它會安靜地通過 —— 因為 stub 什麼都沒做也不會抱怨。
 *    這裡給的是**會炸的 stub**：真的走到通知就立刻失敗，並說清楚該去哪裡測。
 *    要測通知請用 test/assign-notify.test.ts 的 fakeLine 那組。
 */
import type { AssignNotifyService } from "../src/warroom/assign-notify.service.js";
import { TaskConfigService } from "../src/task-config/task-config.service.js";
import { WarroomTasksService } from "../src/warroom/warroom-tasks.service.js";

const explodingNotify = new Proxy({} as AssignNotifyService, {
  get(_t, prop) {
    return () => {
      throw new Error(
        `這個測試走到了指派通知（AssignNotifyService.${String(prop)}），`
        + "但它是用 notTestingNotify() 建的、通知並不在測試範圍內。\n"
        + "要測通知請改用 test/assign-notify.test.ts 的 fakeLine 那組寫法，"
        + "不要在這裡放一個什麼都不做的 stub —— 那會讓斷言安靜地通過。",
      );
    };
  },
});

/** 測看板／逾時／分區用 —— 通知不在範圍內，碰到就炸 */
export function notTestingNotify(cfg: TaskConfigService = new TaskConfigService()): WarroomTasksService {
  return new WarroomTasksService(cfg, explodingNotify);
}
