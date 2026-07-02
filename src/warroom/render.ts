import type { Aggregate, Ticket, WarRoomData } from "./types.js";
import { pct } from "./aggregate.js";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CONF_LABEL = { high: "high", medium: "medium", low: "low" } as const;

function confBars(c: Ticket["confidence"]): string {
  const cls = c ?? "na";
  const n = c === "high" ? 3 : c === "medium" ? 2 : c === "low" ? 1 : 0;
  const bars = [0, 1, 2]
    .map((i) => `<i class="${i < n ? "on" : ""}"></i>`)
    .join("");
  return `<span class="conf ${cls}">${bars} ${c ? CONF_LABEL[c] : "—"}</span>`;
}

/** group_owner 視角：單一群組的每日簽核面板。全部數字由 data + aggregate 計算。 */
export function renderGroupOwner(
  data: WarRoomData,
  agg: Aggregate,
  departmentId: string,
): string {
  const g = agg.groups.find((x) => x.department.department_id === departmentId);
  if (!g) throw new Error(`department ${departmentId} not found`);
  const dept = g.department;
  const tickets = data.tickets.filter((t) => t.department_id === departmentId);
  const lowCount = tickets.filter((t) => t.needs_review).length;
  const highCount = g.high_count;
  const signed = g.signed_off;

  const rows = tickets
    .map((t) => {
      const flagged = t.needs_review;
      return `<tr class="${flagged ? "flag" : ""}">
        <td class="tid mono">${esc(t.ticket_id)}</td>
        <td class="cat">${esc(t.category)}</td>
        <td class="sum">${esc(t.summary)}${flagged ? '<div class="intercept">⚠ 低信心・已即時攔截，需人工補資訊後才可簽核</div>' : ""}${t.linked_ref ? `<span class="ref mono">${esc(t.linked_ref)}</span>` : ""}</td>
        <td class="cf">${confBars(t.confidence)}</td>
        <td class="mc mono">${t.message_count} 則</td>
      </tr>`;
    })
    .join("\n");

  const statusPill = signed
    ? '<span class="pill ok"><span class="dot"></span>已簽核</span>'
    : lowCount > 0
      ? `<span class="pill danger"><span class="dot"></span>${lowCount} 筆低信心待補</span>`
      : '<span class="pill warn"><span class="dot"></span>待簽核</span>';

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>${esc(dept.name)}・每日簽核 — group_owner v7</title>
<style>
  :root{
    --paper:#F6F3EC;--card:#FCFBF6;--well:#F1EEE5;--ink:#1F2A2E;--ink-2:#55605F;--ink-3:#8A938F;
    --line:rgba(31,42,46,.11);--line-2:rgba(31,42,46,.06);
    --pine:#1E5C4F;--pine-2:#2E7D5B;--pine-tint:#E4EDE8;--terra:#C2603A;--terra-tint:#F3E5DC;
    --ok:#2E7D5B;--ok-bg:#E4EDE8;--warn:#A9781A;--warn-bg:#F5EDD8;--danger:#B23A2E;--danger-bg:#F5E3DF;
    --serif:"Georgia","Songti TC","Noto Serif TC",serif;
    --sans:"Avenir Next",-apple-system,"PingFang TC","Noto Sans TC",sans-serif;
    --mono:"SF Mono",ui-monospace,Menlo,monospace;
    --shadow:0 1px 2px rgba(31,42,46,.04),0 10px 30px -22px rgba(31,42,46,.28);
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1600px}
  body{font-family:var(--sans);background:var(--paper);color:var(--ink);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
  .mono{font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
  .serif{font-family:var(--serif)}
  .eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.16em;color:var(--pine);text-transform:uppercase}
  .dot{width:7px;height:7px;border-radius:50%;display:inline-block}
  .mast{background:var(--pine);color:#F3EFE6;display:flex;align-items:center;padding:0 34px;height:60px;gap:20px}
  .mast .crest{width:32px;height:32px;border-radius:8px;background:#F3EFE6;color:var(--pine);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;font-family:var(--serif);flex:none}
  .mast .wm b{font-size:15px;font-weight:600}
  .mast .wm span{display:block;font-size:10.5px;color:rgba(243,239,230,.62)}
  .mast nav{display:flex;gap:3px;margin-left:18px;height:100%}
  .mast nav a{display:flex;align-items:center;padding:0 14px;font-size:13px;color:rgba(243,239,230,.66);text-decoration:none;position:relative}
  .mast nav a.on{color:#fff;font-weight:600}
  .mast nav a.on::after{content:"";position:absolute;left:14px;right:14px;bottom:0;height:2.5px;background:var(--terra);border-radius:2px 2px 0 0}
  .mast .right{margin-left:auto;display:flex;align-items:center;gap:20px}
  .mast .role{text-align:right;line-height:1.2}
  .mast .role b{font-size:12.5px;font-weight:600}
  .mast .role span{display:block;font-size:10.5px;color:rgba(243,239,230,.6)}
  .mast .clock{font-family:var(--mono);font-size:12.5px;color:rgba(243,239,230,.85);border-left:1px solid rgba(243,239,230,.2);padding-left:20px}
  .wrap{padding:22px 34px 30px;display:flex;flex-direction:column;gap:18px}
  .titlebar{display:flex;align-items:flex-end;gap:16px}
  .titlebar h1{font-family:var(--serif);font-size:25px;font-weight:600}
  .titlebar .sub{font-size:12.5px;color:var(--ink-2);margin-bottom:3px}
  .titlebar .tbl{margin-left:auto;font-family:var(--mono);font-size:11.5px;color:var(--pine);background:var(--pine-tint);border-radius:7px;padding:5px 11px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}
  .summary{display:grid;grid-template-columns:repeat(3,1fr) 1.5fr;gap:0}
  .sm{padding:16px 20px}
  .sm+.sm{border-left:1px solid var(--line)}
  .sm .l{font-size:12px;color:var(--ink-2)}
  .sm .v{font-family:var(--serif);font-size:30px;font-weight:600;letter-spacing:-.01em;margin-top:3px}
  .sm .v small{font-size:13px;color:var(--ink-3);font-family:var(--sans);font-weight:500;margin-left:3px}
  .sm .s{font-size:11px;color:var(--ink-3);margin-top:3px;font-family:var(--mono)}
  .sm.action{display:flex;flex-direction:column;justify-content:center;background:var(--pine-tint);border-radius:0 12px 12px 0}
  .sm.action .note{font-size:11.5px;color:var(--ink-2);margin-bottom:9px}
  .sm.action .note b{color:var(--pine);font-weight:600}
  .btn-sign{background:var(--pine);color:#F3EFE6;font-weight:600;font-size:14px;padding:11px 18px;border-radius:9px;text-align:center;box-shadow:inset 0 1px 0 rgba(255,255,255,.14)}
  .pill{display:inline-flex;align-items:center;gap:6px;border-radius:6px;font-size:11px;font-weight:600;padding:2px 8px;white-space:nowrap}
  .pill .dot{width:6px;height:6px}
  .pill.ok{color:var(--ok);background:var(--ok-bg)}
  .pill.warn{color:var(--warn);background:var(--warn-bg)}
  .pill.danger{color:var(--danger);background:var(--danger-bg)}
  .c-hd{display:flex;align-items:center;gap:10px;padding:14px 20px 0}
  .c-hd h2{font-size:13.5px;font-weight:700}
  .c-hd .note{margin-left:auto;font-size:11.5px;color:var(--ink-3)}
  .rule{height:1px;background:var(--line);margin-top:11px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;font-size:10.5px;font-weight:600;color:var(--ink-3);letter-spacing:.05em;padding:9px 14px;border-bottom:1px solid var(--line)}
  td{padding:13px 14px;border-bottom:1px solid var(--line-2);vertical-align:top}
  tr:last-child td{border-bottom:none}
  th:first-child,td:first-child{padding-left:20px}
  th:last-child,td:last-child{padding-right:20px}
  td.tid{color:var(--ink-3);font-size:11px;white-space:nowrap}
  td.cat{white-space:nowrap;font-size:11.5px;color:var(--pine);font-weight:600}
  td.sum{color:var(--ink);line-height:1.55}
  td.sum .ref{display:inline-block;margin-top:4px;font-size:10.5px;color:var(--ink-3)}
  td.sum .intercept{margin-top:5px;font-size:11.5px;color:var(--danger);font-weight:600}
  td.mc{color:var(--ink-3);font-size:11px;white-space:nowrap}
  tr.flag td{background:var(--danger-bg)}
  tr.flag td:first-child{box-shadow:inset 3px 0 0 var(--danger)}
  .conf{display:inline-flex;gap:3px;align-items:center;font-family:var(--mono);font-size:11px;white-space:nowrap}
  .conf i{width:5px;height:12px;border-radius:1px;background:var(--line);display:inline-block}
  .conf.high i.on{background:var(--pine-2)}
  .conf.medium i.on{background:var(--warn)}
  .conf.low i.on{background:var(--terra)}
  footer{display:flex;align-items:center;padding:4px 4px 0;font-size:11px;color:var(--ink-3)}
  footer .mono{font-size:10.5px}
</style>
</head>
<body>
<div class="mast">
  <div class="crest">福</div>
  <div class="wm"><b>台灣福祉科技</b><span>AI 智慧管理戰情室</span></div>
  <nav><a href="#">戰情室</a><a class="on" href="#">每日簽核</a><a href="#">知識檢索</a><a href="#">Ragic 總台</a></nav>
  <div class="right">
    <div class="clock">${esc(agg.as_of.slice(0, 10))}　${esc(agg.as_of.slice(11, 16))}</div>
    <div class="role"><b>${esc(dept.name)}組長</b><span>group_owner・僅本群組・可簽核</span></div>
  </div>
</div>
<div class="wrap">
  <div class="titlebar">
    <div><div class="eyebrow">每日簽核 · 部門負責人</div><h1>${esc(dept.name)}・今日待簽核</h1></div>
    <div class="sub">Human-in-the-loop · 逾 24 小時未簽核自動轉逾時警示</div>
    <div class="tbl">→ ${esc(dept.ragic_table)}</div>
  </div>

  <div class="card summary">
    <div class="sm"><div class="l">今日草稿</div><div class="v serif">${tickets.length}<small>筆</small></div><div class="s">${esc(dept.ragic_table)}</div></div>
    <div class="sm"><div class="l">高信心</div><div class="v serif">${highCount}<small>筆</small></div><div class="s">可直接簽核</div></div>
    <div class="sm"><div class="l">低信心攔截</div><div class="v serif" style="color:var(--terra)">${lowCount}<small>筆</small></div><div class="s">needs_review=true</div></div>
    <div class="sm action">
      <div class="note">${statusPill}　簽核後才寫入 Ragic，<b>低信心項目須先補資訊</b></div>
      <div class="btn-sign">確認今日進度（${tickets.length - lowCount} 筆）</div>
    </div>
  </div>

  <div class="card">
    <div class="c-hd"><h2>AI 今日草稿明細</h2><span class="pill" style="color:var(--pine);background:var(--pine-tint);margin-left:8px"><span class="dot"></span>只有本群組負責人可簽核</span><span class="note">每筆標示 AI 判讀信心度</span></div>
    <div class="rule"></div>
    <table>
      <thead><tr><th>編號</th><th>類別</th><th>AI 草稿摘要</th><th>信心度</th><th>訊息數</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>

  <footer>
    <span>示範資料・姓名與車號已假名化（raw_messages.user_id 假名化處理）　·　簽核後 sync_to_ragic=true</span>
    <span class="mono" style="margin-left:auto">資料源：tickets WHERE department_id='${esc(departmentId)}'　·　登入角色 group_owner　·　全群組簽核 ${agg.signed_groups}/6（${pct(agg.signoff_rate)}%）</span>
  </footer>
</div>
</body>
</html>`;
}
