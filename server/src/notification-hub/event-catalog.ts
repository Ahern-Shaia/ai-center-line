// 內部領域事件型錄（internal_event 來源）
// 作用：讓設定 UI 對「內部事件」的操作方式與 Ragic 表單一致——
//   Ragic：選表單 → metadata/schema 回欄位 → 勾選
//   內部事件：選事件 → 本型錄回欄位 → 勾選
// 新增事件時在此加一筆，前端立即可設定（不需改 UI）。
// 對照 docs/modules/notification-hub.md §4

export interface EventFieldDef {
  path: string;
  label: string;
  /** 可作為數值門檻過濾（OQ-NH-6）*/
  numeric?: boolean;
}

export interface EventDef {
  eventType: string;
  label: string;
  description: string;
  fields: EventFieldDef[];
}

export const EVENT_CATALOG: EventDef[] = [
  {
    eventType: "attendance.suspicious",
    label: "外勤打卡異常",
    description: "打卡推算時速過高（疑似偽造位置）或 GPS 精度過低時觸發",
    fields: [
      { path: "employeeName", label: "員工" },
      { path: "punchTypeLabel", label: "打卡類型" },
      { path: "customerName", label: "到點地點" },
      { path: "impossibleSpeedKmh", label: "推算時速（km/h）", numeric: true },
      { path: "lowAccuracyM", label: "GPS 誤差（公尺）", numeric: true },
      { path: "punchedAt", label: "打卡時間" },
    ],
  },
];

export function findEvent(eventType: string): EventDef | undefined {
  return EVENT_CATALOG.find((e) => e.eventType === eventType);
}
