import { Injectable, Logger } from "@nestjs/common";
import { NotificationPipeline } from "./notification.pipeline.js";
import type { NotificationEvent } from "./types.js";

// 領域事件匯流（OQ-NH-1：自寫簡易 in-process bus · 不加第三方依賴）
// 各模組注入本服務、emit 領域事件即可；要不要通知、通知誰，由 notification_rule 決定。
//
// 用法：
//   this.bus.emit({ sourceType:"internal_event", eventType:"attendance.suspicious",
//                   tenantId, eventLabel:"可疑里程", dedupKey:`susp:${punchId}`, payload:{...} });
//
// 語意：fire-and-forget（不阻擋呼叫端 · 失敗只記 log）。
// 限制：in-process、無持久化 → 程序 crash 時未送出的事件遺失（通知非交易關鍵，可忍；
//       量大/關鍵改 outbox，見 doc §8 FMEA）。
@Injectable()
export class NotificationBus {
  private readonly logger = new Logger(NotificationBus.name);

  constructor(private readonly pipeline: NotificationPipeline) {}

  emit(event: Omit<NotificationEvent, "sourceType"> & { eventType: string }): void {
    const full: NotificationEvent = { ...event, sourceType: "internal_event" };
    setImmediate(() => {
      void this.pipeline.dispatchInternal(full).catch((e) => {
        this.logger.warn(`事件分派失敗 · ${full.eventType} · ${(e as Error).message}`);
      });
    });
  }

  /** 需要等待結果時（測試 / 少數同步情境）*/
  async emitAndWait(event: Omit<NotificationEvent, "sourceType"> & { eventType: string }) {
    return this.pipeline.dispatchInternal({ ...event, sourceType: "internal_event" });
  }
}
