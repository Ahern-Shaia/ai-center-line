import type { ChatMessage } from "./types.js";
import type { AnalysisResultT, Category } from "./schemas.js";
import type { UsageStats } from "./classify.js";

export interface EnrichedMessage extends ChatMessage {
  category: Category | null;
  confidence: string | null;
}

export interface ReportData {
  groupName: string;
  sourceFile: string;
  messages: EnrichedMessage[];
  dailyReports: AnalysisResultT["daily_reports"];
  records: AnalysisResultT["records"];
  usage: UsageStats;
}

const CAT_META: Record<Category, { label: string; color: string; bg: string }> = {
  daily_report: { label: "報工日報", color: "#1d4ed8", bg: "#dbeafe" },
  attendance: { label: "出勤異動", color: "#b45309", bg: "#fef3c7" },
  maintenance: { label: "維保異常", color: "#b91c1c", bg: "#fee2e2" },
  rnd: { label: "研發討論", color: "#6d28d9", bg: "#ede9fe" },
  procurement: { label: "採購", color: "#047857", bg: "#d1fae5" },
  chitchat: { label: "閒聊", color: "#6b7280", bg: "#f3f4f6" },
};

const STATUS_LABEL: Record<string, string> = {
  open: "未處理",
  in_progress: "處理中",
  resolved: "已解決",
  info: "資訊",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badge(cat: Category | null): string {
  if (!cat) return "";
  const m = CAT_META[cat];
  return `<span class="badge" style="color:${m.color};background:${m.bg}">${m.label}</span>`;
}

function nv(v: string | number | null): string {
  return v === null || v === "" ? `<span class="null">—</span>` : esc(String(v));
}

export function renderReport(data: ReportData): string {
  const counts = new Map<Category, number>();
  for (const m of data.messages) {
    if (m.category) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
  }
  const chips = (Object.keys(CAT_META) as Category[])
    .map((c) => {
      const meta = CAT_META[c];
      return `<span class="chip" style="border-color:${meta.color};color:${meta.color}">${meta.label} ${counts.get(c) ?? 0}</span>`;
    })
    .join("");

  let lastDate = "";
  const timelineRows = data.messages
    .map((m) => {
      let dateRow = "";
      if (m.date !== lastDate) {
        lastDate = m.date;
        dateRow = `<tr class="daterow"><td colspan="4">${esc(m.date)}</td></tr>`;
      }
      const textHtml =
        m.kind === "media"
          ? `<span class="media">${esc(m.text)}</span>`
          : esc(m.text).replace(/\n/g, "<br>");
      return `${dateRow}<tr>
        <td class="time">${esc(m.time)}</td>
        <td class="sender">${esc(m.sender)}</td>
        <td class="text">${textHtml}</td>
        <td class="cat">${badge(m.category)}${m.confidence === "low" ? '<span class="lowconf">?</span>' : ""}</td>
      </tr>`;
    })
    .join("\n");

  const drRows = data.dailyReports
    .map(
      (r) => `<tr>
      <td>${nv(r.date)}</td>
      <td>${nv(r.reporter_name)}${r.reporter_code ? `<span class="code">${esc(r.reporter_code)}</span>` : ""}</td>
      <td>${nv(r.line)}</td>
      <td>${nv(r.machine_code)}</td>
      <td>${nv(r.work_order)}</td>
      <td class="num">${nv(r.output_qty)}</td>
      <td class="num">${nv(r.defect_qty)}</td>
      <td class="num">${nv(r.overtime_hours)}</td>
      <td>${nv(r.issues)}</td>
      <td>${esc(r.confidence)}</td>
      <td class="src">${r.source_ids.map((i) => `#${i}`).join(" ")}</td>
    </tr>`,
    )
    .join("\n");

  const recordCards = data.records
    .map((r) => {
      const meta = CAT_META[r.category];
      const status = r.status
        ? `<span class="status status-${r.status}">${STATUS_LABEL[r.status] ?? r.status}</span>`
        : "";
      const ents = [
        r.person ? `人員 ${esc(r.person)}` : "",
        r.machine_code ? `機台 ${esc(r.machine_code)}` : "",
        r.work_order ? `工單 ${esc(r.work_order)}` : "",
      ]
        .filter(Boolean)
        .join("｜");
      return `<div class="card" style="border-left-color:${meta.color}">
        <div class="card-head">${badge(r.category)}${status}<strong>${esc(r.title)}</strong></div>
        <div class="card-body">${esc(r.detail).replace(/\n/g, "<br>")}</div>
        <div class="card-foot">${ents}${ents ? "｜" : ""}來源 ${r.source_ids.map((i) => `#${i}`).join(" ")}｜信心 ${esc(r.confidence)}</div>
      </div>`;
    })
    .join("\n");

  const u = data.usage;

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.groupName)}｜AI 對話分析報告</title>
<style>
  body { font-family: "PingFang TC", "Microsoft JhengHei", sans-serif; margin: 0; background: #f8fafc; color: #1e293b; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 20px 60px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 36px 0 12px; border-left: 4px solid #334155; padding-left: 10px; }
  .sub { color: #64748b; font-size: 13px; margin-bottom: 14px; }
  .chip { display: inline-block; border: 1px solid; border-radius: 999px; padding: 2px 10px; font-size: 12px; margin: 0 6px 6px 0; background: #fff; }
  .badge { display: inline-block; border-radius: 4px; padding: 1px 8px; font-size: 12px; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; background: #fff; font-size: 13px; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  th, td { border-bottom: 1px solid #e2e8f0; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; white-space: nowrap; }
  tr.daterow td { background: #e2e8f0; font-weight: 700; font-size: 12px; }
  td.time { white-space: nowrap; color: #64748b; width: 52px; }
  td.sender { white-space: nowrap; font-weight: 600; width: 90px; }
  td.cat { white-space: nowrap; width: 90px; }
  td.num { text-align: right; }
  td.src, .code { color: #94a3b8; font-size: 12px; }
  .code { margin-left: 4px; }
  .media { color: #94a3b8; font-style: italic; }
  .null { color: #cbd5e1; }
  .lowconf { color: #dc2626; margin-left: 3px; font-weight: 700; }
  .card { background: #fff; border-left: 4px solid; border-radius: 6px; padding: 12px 14px; margin-bottom: 10px; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  .card-head { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
  .card-body { font-size: 13px; line-height: 1.7; }
  .card-foot { margin-top: 8px; color: #94a3b8; font-size: 12px; }
  .status { border-radius: 4px; padding: 1px 8px; font-size: 12px; }
  .status-open { background: #fee2e2; color: #b91c1c; }
  .status-in_progress { background: #fef3c7; color: #b45309; }
  .status-resolved { background: #d1fae5; color: #047857; }
  .status-info { background: #f1f5f9; color: #475569; }
  .usage { margin-top: 40px; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(data.groupName)}｜AI 對話分析報告</h1>
  <div class="sub">來源檔案：${esc(data.sourceFile)}｜共 ${data.messages.length} 則訊息｜結構化日報 ${data.dailyReports.length} 筆｜其他記錄 ${data.records.length} 筆</div>
  <div>${chips}</div>

  <h2>結構化報工日報（→ Ragic 報工表單）</h2>
  ${
    data.dailyReports.length
      ? `<table>
    <thead><tr><th>日期</th><th>回報人</th><th>線別</th><th>機台</th><th>工單</th><th>產出</th><th>不良</th><th>加班(h)</th><th>備註/異常</th><th>信心</th><th>來源</th></tr></thead>
    <tbody>${drRows}</tbody>
  </table>`
      : `<div class="sub">此群組無報工日報。</div>`
  }

  <h2>抽取記錄（→ 知識庫 / 對應模組）</h2>
  ${recordCards || `<div class="sub">無抽取記錄。</div>`}

  <h2>訊息時間軸（逐則分類）</h2>
  <table>
    <thead><tr><th>時間</th><th>發訊者</th><th>內容</th><th>分類</th></tr></thead>
    <tbody>${timelineRows}</tbody>
  </table>

  <div class="usage">API 用量：${u.calls} 次呼叫｜input ${u.inputTokens}｜cache 寫入 ${u.cacheWriteTokens}｜cache 讀取 ${u.cacheReadTokens}｜output ${u.outputTokens} tokens｜模型 claude-opus-4-7</div>
</div>
</body>
</html>`;
}
