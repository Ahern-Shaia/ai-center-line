/**
 * 把 AI 抽出來的 `due_at` 字串，轉成可以寫進 `tickets.due_at`（timestamptz）的值。
 *
 * ⚠️⚠️ **這一層不能省。** `due_at` 是**模型產生的字串** ——
 *    直接丟進 timestamptz 欄位，一個爛值就會讓**整批材料化交易失敗**，
 *    那一批連一張卡都進不去。壞掉的不是行事曆，是客戶當天的任務看板。
 *    寧可這一筆沒有日期，也不能讓整批掛掉。
 *
 * ⚠️⚠️ **時區必須明講。** 模型回的是 `"2026-09-08T10:00"`，沒有時區。
 *    交給 Postgres 或 `new Date()` 猜，會被當成 UTC → **早 8 小時**
 *    （FMEA F-7）。使用者會在錯的時間出現在錯的地方。
 *    這裡一律當**台北時間**，明確補上 `+08:00`。
 *
 * ⚠️ R11：抽不到就是 null。這支**不做任何推測**——
 *    看不懂的字串（「下週三」「月底前」）一律回 null，
 *    原文由 `due_text` 保留給人核對。
 */

/** 台北時區固定 +08:00（台灣不實施日光節約時間，可以寫死） */
const TAIPEI_OFFSET = "+08:00";

/**
 * @returns 可直接寫進 timestamptz 的 ISO 字串；看不懂或沒有就回 null
 */
export function parseDueAt(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s === "") return null;

  // 只接受這兩種形狀 —— 模型被要求輸出的就是這兩種。
  // ⚠️ 刻意**不做寬鬆解析**：能多認一種格式，就多一種認錯的方式，
  //    而認錯的代價是使用者在錯的日子赴約（FMEA F-1 · P0）。
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const dateTime = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(s);
  const m = dateTime ?? dateOnly;
  if (!m) return null;

  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [hh, mi] = dateTime ? [Number(m[4]), Number(m[5])] : [0, 0];

  // 範圍檢查 —— regex 擋不掉 2026-13-45 這種
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59) return null;

  const iso = `${m[1]}-${m[2]}-${m[3]}T${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00${TAIPEI_OFFSET}`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;

  // ⚠️ 光驗 NaN 不夠：`2026-02-30` 這種日子有些引擎會「好心」正規化成 3/2 而不報錯。
  //    所以把時間戳換回台北的牆上時間，比對日期有沒有被搬動過。
  const tpe = new Date(t + 8 * 3600 * 1000);
  if (tpe.getUTCFullYear() !== y || tpe.getUTCMonth() + 1 !== mo || tpe.getUTCDate() !== d) return null;

  return iso;
}
