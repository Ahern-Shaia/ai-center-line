import type { NotificationTemplate } from "../db/schema.js";
import type { InternalSourceConfig } from "./types.js";

// 通用模板渲染 + 規則過濾（純函式 · 可測）
// 演進自 notify v2 的 composeFromConfig：path 取值改支援 dot-path，來源無關。
// 對照 docs/modules/notification-hub.md §6
const MAX_LINE_LENGTH = 200;

/** dot-path 取值：Ragic 欄位 id（"1031954"）或領域事件（"trip.distanceKm"）皆可 */
export function getByPath(payload: Record<string, unknown>, path: string): unknown {
  if (path in payload) return payload[path];          // 先試整段 key（Ragic 欄位 id 含數字）
  let cur: unknown = payload;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function s(v: unknown): string {
  if (v == null || v === "") return "（未填）";
  const cleaned = String(v).replace(/[\r\n\t]+/g, " ").slice(0, MAX_LINE_LENGTH).trim();
  return cleaned || "（未填）";
}

export function renderTemplate(
  template: NotificationTemplate,
  payload: Record<string, unknown>,
  eventLabel: string,
  link?: string | null,
): string {
  const items = [...(template.items ?? [])].sort((a, b) => a.order - b.order);
  // 標題與事件標籤相同時不重複（內部事件常見：標題即事件名）
  const title = s(template.title);
  const header = !eventLabel || eventLabel === title ? title : `${title}｜${eventLabel}`;
  const lines: string[] = [`【${header}】`];
  for (const it of items) {
    lines.push(`${it.label}：${s(getByPath(payload, it.path))}`);
  }
  if (link) lines.push("", "檢視完整資料：", link);
  return lines.join("\n");
}

/** internal_event 規則過濾（相等 + 數值門檻）· 無 filters 一律通過 */
export function matchFilters(cfg: InternalSourceConfig, payload: Record<string, unknown>): boolean {
  const filters = cfg.filters ?? [];
  for (const f of filters) {
    const raw = getByPath(payload, f.path);
    if (f.op === "eq") {
      if (String(raw ?? "") !== String(f.value)) return false;
      continue;
    }
    const n = Number(raw);
    const target = Number(f.value);
    if (Number.isNaN(n) || Number.isNaN(target)) return false;
    if (f.op === "gte" && !(n >= target)) return false;
    if (f.op === "lte" && !(n <= target)) return false;
  }
  return true;
}
