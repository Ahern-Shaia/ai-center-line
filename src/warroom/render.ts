import type {
  Aggregate, AiprootData, GroupStatus, Health, SubsidyMeasure,
  Ticket, WarRoomData,
} from "./types.js";
import { pct } from "./aggregate.js";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const RING_C = 326.726; // 2π·52

function ring(ratio: number, color: string): string {
  const dash = (ratio * RING_C).toFixed(1);
  return `<svg width="118" height="118" viewBox="0 0 118 118">
    <circle cx="59" cy="59" r="52" fill="none" stroke="#E4E0D5" stroke-width="11"/>
    <circle cx="59" cy="59" r="52" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${dash} ${RING_C}"/>
  </svg>`;
}

function confBars(c: Ticket["confidence"]): string {
  const cls = c ?? "na";
  const n = c === "high" ? 3 : c === "medium" ? 2 : c === "low" ? 1 : 0;
  const bars = [0, 1, 2].map((i) => `<i class="${i < n ? "on" : ""}"></i>`).join("");
  return `<span class="conf ${cls}">${bars} ${c ?? "—"}</span>`;
}

const HEALTH_COLOR: Record<Health | "idle", string> = {
  green: "var(--ok)", yellow: "var(--warn)", red: "var(--danger)", idle: "var(--ink-3)",
};

function worstConf(tickets: Ticket[]): Ticket["confidence"] {
  if (tickets.some((t) => t.confidence === "low")) return "low";
  if (tickets.some((t) => t.confidence === "medium")) return "medium";
  if (tickets.some((t) => t.confidence === "high")) return "high";
  return null;
}

function fmtActivity(iso: string, asOf: string): string {
  const d = iso.slice(0, 10), t = iso.slice(11, 16), today = asOf.slice(0, 10);
  if (d === today) return t;
  const diff = Math.round(
    (new Date(today + "T00:00:00").getTime() - new Date(d + "T00:00:00").getTime()) / 86400000,
  );
  return diff === 1 ? `昨 ${t}` : d.slice(5);
}

// ───────────────────────── shared civic-trust styles ─────────────────────────
const STYLES = `
  :root{--paper:#F6F3EC;--card:#FCFBF6;--well:#F1EEE5;--ink:#1F2A2E;--ink-2:#55605F;--ink-3:#8A938F;
    --line:rgba(31,42,46,.11);--line-2:rgba(31,42,46,.06);--pine:#1E5C4F;--pine-2:#2E7D5B;--pine-tint:#E4EDE8;
    --terra:#C2603A;--terra-tint:#F3E5DC;--ok:#2E7D5B;--ok-bg:#E4EDE8;--warn:#A9781A;--warn-bg:#F5EDD8;
    --danger:#B23A2E;--danger-bg:#F5E3DF;--serif:"Georgia","Songti TC","Noto Serif TC",serif;
    --sans:"Avenir Next",-apple-system,"PingFang TC","Noto Sans TC",sans-serif;--mono:"SF Mono",ui-monospace,Menlo,monospace;
    --shadow:0 1px 2px rgba(31,42,46,.04),0 10px 30px -22px rgba(31,42,46,.28);}
  *{margin:0;padding:0;box-sizing:border-box}html,body{width:1600px}
  body{font-family:var(--sans);background:var(--paper);color:var(--ink);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
  .mono{font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.01em}.serif{font-family:var(--serif)}
  .eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.16em;color:var(--pine);text-transform:uppercase}
  .dot{width:7px;height:7px;border-radius:50%;display:inline-block}
  .mast{background:var(--pine);color:#F3EFE6;display:flex;align-items:center;padding:0 34px;height:60px;gap:20px}
  .mast .crest{width:32px;height:32px;border-radius:8px;background:#F3EFE6;color:var(--pine);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;font-family:var(--serif);flex:none}
  .mast .wm b{font-size:15px;font-weight:600}.mast .wm span{display:block;font-size:10.5px;color:rgba(243,239,230,.62)}
  .mast nav{display:flex;gap:3px;margin-left:18px;height:100%}
  .mast nav a{display:flex;align-items:center;padding:0 14px;font-size:13px;color:rgba(243,239,230,.66);text-decoration:none;position:relative}
  .mast nav a.on{color:#fff;font-weight:600}
  .mast nav a.on::after{content:"";position:absolute;left:14px;right:14px;bottom:0;height:2.5px;background:var(--terra);border-radius:2px 2px 0 0}
  .mast .right{margin-left:auto;display:flex;align-items:center;gap:20px}
  .mast .role{text-align:right;line-height:1.2}.mast .role b{font-size:12.5px;font-weight:600}.mast .role span{display:block;font-size:10.5px;color:rgba(243,239,230,.6)}
  .mast .eng{font-size:11.5px;color:rgba(243,239,230,.72);display:flex;align-items:center;gap:7px;font-family:var(--mono)}
  .mast .clock{font-family:var(--mono);font-size:12.5px;color:rgba(243,239,230,.85);border-left:1px solid rgba(243,239,230,.2);padding-left:20px}
  .wrap{padding:22px 34px 30px;display:flex;flex-direction:column;gap:18px}
  .titlebar{display:flex;align-items:flex-end;gap:16px}
  .titlebar h1{font-family:var(--serif);font-size:25px;font-weight:600}
  .titlebar .sub{font-size:12.5px;color:var(--ink-2);margin-bottom:3px}
  .titlebar .flag{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--ink-2);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 12px}
  .titlebar .tbl{margin-left:auto;font-family:var(--mono);font-size:11.5px;color:var(--pine);background:var(--pine-tint);border-radius:7px;padding:5px 11px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}
  .c-hd{display:flex;align-items:center;gap:10px;padding:14px 20px 0}.c-hd h2{font-size:13.5px;font-weight:700}
  .c-hd .note{margin-left:auto;font-size:11.5px;color:var(--ink-3)}.rule{height:1px;background:var(--line);margin-top:11px}
  .pill{display:inline-flex;align-items:center;gap:6px;border-radius:6px;font-size:11px;font-weight:600;padding:2px 8px;white-space:nowrap}
  .pill .dot{width:6px;height:6px}.pill.ok{color:var(--ok);background:var(--ok-bg)}.pill.warn{color:var(--warn);background:var(--warn-bg)}
  .pill.danger{color:var(--danger);background:var(--danger-bg)}.pill.pine{color:var(--pine);background:var(--pine-tint)}
  .pill.terra{color:var(--terra);background:var(--terra-tint)}.pill.ghost{color:var(--ink-2);background:var(--well)}
  .gov{display:grid;grid-template-columns:1.55fr 1fr;gap:18px}.gauges{display:grid;grid-template-columns:repeat(3,1fr)}
  .gauge{padding:16px 18px 18px;text-align:center}.gauge+.gauge{border-left:1px solid var(--line)}
  .gauge .ring{position:relative;width:118px;height:118px;margin:4px auto 0}.gauge .ring svg{transform:rotate(-90deg)}
  .gauge .ring .ctr{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .gauge .ring .val{font-family:var(--serif);font-size:34px;font-weight:600;line-height:1}.gauge .ring .val small{font-size:15px}
  .gauge .ring .frac{font-family:var(--mono);font-size:10.5px;color:var(--ink-3);margin-top:3px}
  .gauge .lbl{font-size:13px;font-weight:600;margin-top:13px}.gauge .calc{font-size:11px;color:var(--ink-3);margin-top:4px;font-family:var(--mono)}
  .gov-side{padding:15px 20px 12px;display:flex;flex-direction:column}.gov-side p{font-size:12.5px;line-height:1.75;color:var(--ink-2);margin-top:8px}
  .gov-side p b{color:var(--ink);font-weight:600}.gov-side .metrics{margin-top:auto;padding-top:12px;border-top:1px solid var(--line);display:flex}
  .gov-side .m{flex:1}.gov-side .m+.m{border-left:1px solid var(--line);padding-left:14px}
  .gov-side .m .mv{font-family:var(--serif);font-size:23px;font-weight:600}.gov-side .m .mv small{font-size:12px;color:var(--ink-3);font-family:var(--sans);font-weight:500;margin-left:2px}
  .gov-side .m .ml{font-size:11px;color:var(--ink-2);margin-top:1px}.gov-side .m .ml .src{color:var(--ink-3);font-family:var(--mono);font-size:10px;display:block;margin-top:1px}
  .groups{display:grid;grid-template-columns:repeat(6,1fr)}.grp{padding:13px 16px 14px}.grp+.grp{border-left:1px solid var(--line)}
  .grp .top{display:flex;align-items:center;gap:8px}.grp .top .nm{font-weight:650;font-size:13px}
  .grp .tbl{font-family:var(--mono);font-size:10.5px;color:var(--pine);margin-top:8px;background:var(--pine-tint);border-radius:5px;padding:2px 6px;display:inline-block}
  .grp .st{font-size:11px;color:var(--ink-2);margin-top:7px}.grp .tm{font-size:10.5px;color:var(--ink-3);margin-top:2px;font-family:var(--mono)}
  .grp.alert{background:var(--danger-bg)}.grp.alert .st{color:var(--danger);font-weight:600}
  .signoff table,table.tbl2{width:100%;border-collapse:collapse;font-size:12.5px}
  .signoff th{text-align:left;font-size:10.5px;font-weight:600;color:var(--ink-3);letter-spacing:.05em;padding:9px 14px;border-bottom:1px solid var(--line)}
  .signoff td{padding:12px 14px;border-bottom:1px solid var(--line-2);vertical-align:middle}.signoff tr:last-child td{border-bottom:none}
  .signoff th:first-child,.signoff td:first-child{padding-left:20px}.signoff th:last-child,.signoff td:last-child{padding-right:20px}
  .signoff td.grp2{font-weight:650;white-space:nowrap}.signoff td .draft{color:var(--ink-2)}.signoff td .draft b{color:var(--ink);font-weight:600}
  .signoff td .sub{color:var(--ink-3);font-size:11px;margin-top:2px}
  .conf{display:inline-flex;gap:3px;align-items:center;font-family:var(--mono);font-size:11px;white-space:nowrap}
  .conf i{width:5px;height:12px;border-radius:1px;background:var(--line);display:inline-block}
  .conf.high i.on{background:var(--pine-2)}.conf.medium i.on{background:var(--warn)}.conf.low i.on{background:var(--terra)}
  .btn-sign{background:var(--pine);color:#F3EFE6;font-weight:600;font-size:12px;padding:6px 14px;border-radius:7px;white-space:nowrap;box-shadow:inset 0 1px 0 rgba(255,255,255,.14)}
  .btn-done{color:var(--ok);font-weight:600;font-size:12px;display:inline-flex;align-items:center;gap:6px}
  .trio{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:18px}
  .chat-body{padding:14px 18px 16px;display:flex;flex-direction:column;gap:10px}
  .bubble{max-width:88%;font-size:12.5px;line-height:1.6;padding:9px 13px;border-radius:12px}
  .bubble.q{align-self:flex-end;background:var(--pine);color:#F3EFE6;border-bottom-right-radius:4px}
  .bubble.a{align-self:flex-start;background:var(--well);color:var(--ink);border-bottom-left-radius:4px}
  .bubble.a .cite{display:inline-block;margin-top:6px;font-family:var(--mono);font-size:10.5px;color:var(--pine);background:var(--pine-tint);border-radius:4px;padding:1px 6px}
  .bubble.a .cite.itri{color:var(--terra);background:var(--terra-tint)}
  .chat-in{margin:2px 18px 14px;border:1px solid var(--line);border-radius:9px;background:var(--well);padding:8px 12px;font-size:12px;color:var(--ink-3);display:flex;align-items:center}
  .chat-in .send{margin-left:auto;width:24px;height:24px;border-radius:6px;background:var(--pine);color:#F3EFE6;display:flex;align-items:center;justify-content:center;font-size:12px}
  .assets{padding:12px 18px 14px;display:flex;flex-direction:column;gap:9px}.asset{display:flex;gap:11px;align-items:center}
  .asset .th{width:42px;height:42px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;font-size:15px}
  .asset .th.img{background:#E7EDDF}.asset .th.vid{background:var(--terra-tint)}.asset .th.pdf{background:var(--pine-tint)}.asset .th.csv{background:var(--well)}
  .asset .m3 .t{font-size:12px;font-weight:600}.asset .m3 .s{font-size:10.5px;color:var(--ink-3);margin-top:2px}.asset .m3 .s .g{color:var(--pine);font-family:var(--mono)}
  .map{padding:12px 18px 14px}.map-canvas{position:relative;height:176px;background:linear-gradient(160deg,#EEF0E7,#E7ECE2);border-radius:9px;overflow:hidden;border:1px solid var(--line)}
  .map-canvas svg{position:absolute;inset:0;width:100%;height:100%}.pin{position:absolute;transform:translate(-50%,-50%)}
  .pin .d3{width:9px;height:9px;border-radius:50%;background:var(--terra);box-shadow:0 0 0 4px rgba(194,96,58,.16)}
  .pin.big .d3{width:13px;height:13px;box-shadow:0 0 0 6px rgba(194,96,58,.2)}
  .map .legend2{display:flex;gap:14px;margin-top:9px;font-size:11px;color:var(--ink-2)}.map .legend2 b{color:var(--ink);font-family:var(--serif);font-weight:600}
  footer{display:flex;align-items:center;padding:4px 4px 0;font-size:11px;color:var(--ink-3)}footer .mono{font-size:10.5px}
  /* group_owner */
  .summary{display:grid;grid-template-columns:repeat(3,1fr) 1.5fr}.sm{padding:16px 20px}.sm+.sm{border-left:1px solid var(--line)}
  .sm .l{font-size:12px;color:var(--ink-2)}.sm .v{font-family:var(--serif);font-size:30px;font-weight:600;margin-top:3px}
  .sm .v small{font-size:13px;color:var(--ink-3);font-family:var(--sans);font-weight:500;margin-left:3px}.sm .s{font-size:11px;color:var(--ink-3);margin-top:3px;font-family:var(--mono)}
  .sm.action{display:flex;flex-direction:column;justify-content:center;background:var(--pine-tint);border-radius:0 12px 12px 0}
  .sm.action .note{font-size:11.5px;color:var(--ink-2);margin-bottom:9px}.sm.action .note b{color:var(--pine);font-weight:600}
  .sm.action .btn-lg{background:var(--pine);color:#F3EFE6;font-weight:600;font-size:14px;padding:11px 18px;border-radius:9px;text-align:center;box-shadow:inset 0 1px 0 rgba(255,255,255,.14)}
  table.tbl2 th{text-align:left;font-size:10.5px;font-weight:600;color:var(--ink-3);letter-spacing:.05em;padding:9px 14px;border-bottom:1px solid var(--line)}
  table.tbl2 td{padding:13px 14px;border-bottom:1px solid var(--line-2);vertical-align:top}table.tbl2 tr:last-child td{border-bottom:none}
  table.tbl2 th:first-child,table.tbl2 td:first-child{padding-left:20px}table.tbl2 th:last-child,table.tbl2 td:last-child{padding-right:20px}
  td.tid{color:var(--ink-3);font-size:11px;white-space:nowrap}td.cat{white-space:nowrap;font-size:11.5px;color:var(--pine);font-weight:600}
  td.sum{color:var(--ink);line-height:1.55}td.sum .ref{display:inline-block;margin-top:4px;font-size:10.5px;color:var(--ink-3)}
  td.sum .intercept{margin-top:5px;font-size:11.5px;color:var(--danger);font-weight:600}td.mc{color:var(--ink-3);font-size:11px;white-space:nowrap}
  tr.flag td{background:var(--danger-bg)}tr.flag td:first-child{box-shadow:inset 3px 0 0 var(--danger)}
  /* aiproot */
  .isolation{display:flex;align-items:center;gap:12px;background:var(--pine-tint);border:1px solid rgba(30,92,79,.22);border-radius:10px;padding:11px 18px}
  .isolation .lock{width:30px;height:30px;border-radius:8px;background:var(--pine);color:#F3EFE6;display:flex;align-items:center;justify-content:center;font-size:15px;flex:none}
  .isolation .t{font-size:12.5px;color:var(--ink);font-weight:600}.isolation .t span{display:block;font-weight:400;color:var(--ink-2);font-size:11.5px;margin-top:1px}
  .isolation .tag{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--pine)}
  .top{display:grid;grid-template-columns:1fr 2.3fr;gap:18px}.kpis{display:grid;grid-template-rows:repeat(2,1fr);gap:18px}.kcol{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .kpi{padding:15px 18px}.kpi .kl{font-size:12px;color:var(--ink-2)}.kpi .kv{font-family:var(--serif);font-size:30px;font-weight:600;margin-top:4px}
  .kpi .kv small{font-size:13px;color:var(--ink-3);font-family:var(--sans);font-weight:500;margin-left:3px}.kpi .ks{font-size:11px;color:var(--ink-3);margin-top:3px;font-family:var(--mono)}
  .funnel{padding:14px 20px 18px}.stages{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:12px}
  .stage{border:1px solid var(--line);border-radius:10px;padding:12px 13px 13px;background:var(--paper)}
  .stage .sh{font-size:12px;font-weight:650}.stage .sh small{display:block;font-weight:400;color:var(--ink-3);font-size:10.5px;margin-top:1px}
  .stage .bar{display:flex;height:7px;border-radius:4px;overflow:hidden;margin:11px 0 10px;background:var(--well)}.stage .bar i{height:100%}
  .stat{display:flex;align-items:center;font-size:11.5px;color:var(--ink-2);padding:2.5px 0}.stat .sd{width:7px;height:7px;border-radius:2px;margin-right:7px}
  .stat .sn{margin-left:auto;font-family:var(--mono);font-weight:600;color:var(--ink)}
  td.co b{font-weight:650}td.co .ind{color:var(--ink-3);font-size:11px;margin-top:1px}
  .health{display:inline-flex;gap:4px;align-items:center}.health .h{width:9px;height:9px;border-radius:50%}
  .health .locknote{margin-left:8px;font-size:10px;color:var(--ink-3);font-family:var(--mono)}
  .seat{font-family:var(--mono);font-size:12px}.seatbar{width:54px;height:5px;border-radius:3px;background:var(--well);margin-top:4px;overflow:hidden}.seatbar i{display:block;height:100%;background:var(--pine-2)}
  td.act .go{color:var(--pine);font-weight:600;font-size:12px}td.act .na{color:var(--ink-3);font-size:11.5px}
  .t-more{padding:11px 20px;font-size:11.5px;color:var(--ink-3);background:var(--well);border-top:1px solid var(--line);border-radius:0 0 12px 12px}
`;

function doc(title: string, body: string, extraCss = ""): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLES}${extraCss}</style></head>
<body>
${body}
</body></html>`;
}

// 線性 SVG 圖示（取代 emoji，去 AI 感）
const IC: Record<string, string> = {
  image: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.6" cy="6.6" r="1.2"/><path d="M2.6 11.5l3.4-3 2.4 2 2.8-2.8 2.4 2.3"/>',
  video: '<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M6.6 6.2l3.4 1.8-3.4 1.8z" fill="currentColor" stroke="none"/>',
  pdf: '<path d="M4 2.2h5.2l3 3v8.6H4z"/><path d="M9.2 2.2v3.2h3"/>',
  csv: '<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1"/><path d="M2.4 6.1h11.2M2.4 9.9h11.2M6.2 2.4v11.2"/>',
  chat: '<path d="M2.5 3.4h11v7h-6l-3 2.4v-2.4h-2z"/>',
  search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 14 14"/>',
  arrow: '<path d="M4 8h6.6M8 5l3 3-3 3"/>',
};
const icon = (name: string, size = 15): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${IC[name]}</svg>`;

// v8 broadsheet styles（報告頭版：規線分節、serif 大數字、bullet meter、線性圖示）
const V8_CSS = `
  .sheet{background:var(--card);border:1px solid var(--line);border-radius:3px;box-shadow:var(--shadow);overflow:hidden}
  .bs-name{display:flex;align-items:flex-end;gap:16px;padding:20px 26px 13px;border-bottom:3px solid var(--pine);position:relative}
  .bs-name::after{content:"";position:absolute;left:0;right:0;bottom:-4px;height:1px;background:var(--pine)}
  .bs-name .kicker{font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--pine);text-transform:uppercase;margin-bottom:8px}
  .bs-name h1{font-family:var(--serif);font-size:33px;font-weight:600;letter-spacing:.01em;line-height:1}
  .bs-name .dateline{margin-left:auto;text-align:right;font-family:var(--mono);font-size:10.5px;color:var(--ink-2);line-height:1.7;letter-spacing:.04em}
  .lead{display:grid;grid-template-columns:1.72fr 1fr;border-bottom:1px solid var(--line)}
  .lead .prose{padding:20px 28px 17px;border-right:1px solid var(--line)}
  .lead .prose .eyebrow{margin-bottom:11px}
  .lead .prose p{font-size:16px;line-height:1.95;color:var(--ink)}
  .lead .prose p b{font-weight:600}
  .lead .prose .fig{font-family:var(--serif);font-size:23px;font-weight:600;color:var(--pine);letter-spacing:-.01em}
  .lead .prose .fig.t{color:var(--terra)}
  .lead .prose sup{font-family:var(--mono);font-size:9px;color:var(--terra);vertical-align:super;margin-left:1px}
  .lead .prose .notes{margin-top:15px;padding-top:12px;border-top:1px solid var(--line);font-family:var(--mono);font-size:10px;color:var(--ink-3);line-height:2}
  .lead .prose .notes b{color:var(--ink-2)}
  .meters{padding:15px 26px 12px;display:flex;flex-direction:column;justify-content:center}
  .meter{padding:10px 0;border-bottom:1px solid var(--line)}.meter:last-child{border-bottom:none}
  .meter .mt{display:flex;align-items:baseline}.meter .ml2{font-size:12px;color:var(--ink-2)}
  .meter .mv2{margin-left:auto;font-family:var(--serif);font-size:27px;font-weight:600;line-height:1}
  .meter .track{height:5px;background:var(--well);border-radius:0;margin:9px 0 5px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--line-2)}
  .meter .track i{display:block;height:100%}
  .meter .cap{font-family:var(--mono);font-size:9.5px;color:var(--ink-3);letter-spacing:.02em}
  .opsrow{display:flex;border-bottom:1px solid var(--line);background:var(--well)}
  .opsrow .op{padding:11px 26px;display:flex;align-items:baseline;gap:8px}.opsrow .op+.op{border-left:1px solid var(--line)}
  .opsrow .op .ov{font-family:var(--serif);font-size:19px;font-weight:600}.opsrow .op .ol{font-size:11.5px;color:var(--ink-2)}
  .opsrow .op .os{font-family:var(--mono);font-size:9.5px;color:var(--ink-3);margin-left:auto;padding-left:14px}
  .opsrow .op:last-child{margin-left:auto;background:transparent}
  .bs-sec{display:flex;align-items:baseline;gap:11px;padding:15px 26px 3px}
  .bs-sec .no{font-family:var(--mono);font-size:11px;color:var(--terra);font-weight:700;letter-spacing:.05em}
  .bs-sec h2{font-family:var(--serif);font-size:16px;font-weight:600}
  .bs-sec .note{margin-left:auto;font-size:11px;color:var(--ink-3)}
  .bs-hr{height:1px;background:var(--line);margin:9px 26px 0}
  .reg{padding:4px 0 8px}
  .regrow{display:flex;align-items:center;gap:14px;padding:11px 26px;border-bottom:1px solid var(--line-2)}
  .regrow:last-child{border-bottom:none}
  .regrow .idx{font-family:var(--mono);font-size:11px;color:var(--ink-3);width:18px}
  .regrow .rdot{width:8px;height:8px;border-radius:50%;flex:none}
  .regrow .rname{font-weight:650;font-size:14px;width:92px}
  .regrow .rtbl{font-family:var(--mono);font-size:11px;color:var(--pine);background:var(--pine-tint);padding:2px 7px;border-radius:3px}
  .regrow .rst{margin-left:auto;font-size:12px;color:var(--ink-2)}
  .regrow .rtm{font-family:var(--mono);font-size:11px;color:var(--ink-3);width:64px;text-align:right}
  .regrow.alert{background:var(--danger-bg)}.regrow.alert .rst{color:var(--danger);font-weight:600}
  .so2{width:100%;border-collapse:collapse;font-size:12.5px}
  .so2 th{text-align:left;font-family:var(--mono);font-size:10px;font-weight:600;color:var(--ink-3);letter-spacing:.08em;text-transform:uppercase;padding:8px 14px;border-bottom:1px solid var(--ink-2)}
  .so2 td{padding:12px 14px;border-bottom:1px solid var(--line-2);vertical-align:top}
  .so2 tr:last-child td{border-bottom:none}
  .so2 th:first-child,.so2 td:first-child{padding-left:26px}.so2 th:last-child,.so2 td:last-child{padding-right:26px;text-align:right}
  .so2 td.g2{font-weight:650;white-space:nowrap}.so2 td .d2{color:var(--ink-2);line-height:1.55}.so2 td .d2 b{color:var(--ink);font-weight:600}
  .so2 td .isub{color:var(--terra);font-size:11px;margin-top:3px;font-weight:600}
  .so2 td .rsub{color:var(--ink-3);font-size:11px;margin-top:3px}
  .apx{display:grid;grid-template-columns:1.25fr 1fr 1fr;border-top:1px solid var(--line)}
  .apx .col{padding:15px 22px 18px}.apx .col+.col{border-left:1px solid var(--line)}
  .apx .ch{display:flex;align-items:center;gap:8px;font-family:var(--serif);font-size:13.5px;font-weight:600;margin-bottom:11px}
  .apx .ch svg{color:var(--pine)}
  .q2,.a2{font-size:12px;line-height:1.6;margin-bottom:8px;max-width:92%}
  .q2{margin-left:auto;color:var(--ink-2);text-align:right;font-style:italic}
  .a2{color:var(--ink)}
  .a2 .ci{display:inline-block;margin-top:3px;font-family:var(--mono);font-size:10px;color:var(--pine);border-bottom:1px dotted var(--pine)}
  .a2 .ci.itri{color:var(--terra);border-color:var(--terra)}
  .amrow{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line-2)}
  .amrow:last-child{border-bottom:none}.amrow .ai2{color:var(--pine);flex:none}
  .amrow .an{font-size:12px;font-weight:600}.amrow .as{font-size:10.5px;color:var(--ink-3);font-family:var(--mono)}
  .amrow .ag{margin-left:auto;font-size:10.5px;color:var(--pine);font-family:var(--mono)}
  .m2c{position:relative;height:150px;background:var(--well);border:1px solid var(--line);border-radius:2px;overflow:hidden;margin-top:2px}
  .m2c svg.map{position:absolute;inset:0;width:100%;height:100%}
  .m2c .pin2{position:absolute;transform:translate(-50%,-50%);width:8px;height:8px;border-radius:50%;background:var(--terra);box-shadow:0 0 0 3px rgba(194,96,58,.16)}
  .m2c .pin2.big{width:11px;height:11px;box-shadow:0 0 0 5px rgba(194,96,58,.2)}
  .apx .mleg{margin-top:9px;font-family:var(--mono);font-size:10.5px;color:var(--ink-2)}.apx .mleg b{font-family:var(--serif);color:var(--ink)}
  .bs-foot{display:flex;padding:12px 26px;border-top:1px solid var(--line);font-family:var(--mono);font-size:10px;color:var(--ink-3);letter-spacing:.03em}
`;

export function renderTenantAdminV8(data: WarRoomData, agg: Aggregate): string {
  const yellow = agg.groups.filter((x) => x.health === "yellow").length;
  const red = agg.groups.filter((x) => x.health === "red").length;

  const meter = (label: string, ratio: number, num: string, color: string): string =>
    `<div class="meter"><div class="mt"><span class="ml2">${label}</span><span class="mv2 serif">${pct(ratio)}<span style="font-size:14px">%</span></span></div>
      <div class="track"><i style="width:${pct(ratio)}%;background:${color}"></i></div><div class="cap">${num}</div></div>`;

  const regRows = agg.groups.map((gs, i) => {
    const d = gs.department;
    const isRag = d.ragic_table.includes("工研院");
    const st = gs.health === "red" ? "逾時警示 · 連續無新活動"
      : gs.signed_off ? `已簽核${isRag ? " · 已同步工研院 RAG" : ""}`
      : gs.has_low_pending ? "低信心待補，需人工補資訊"
      : `正常處理中 · 今日 ${gs.today_total} 則`;
    return `<div class="regrow${gs.health === "red" ? " alert" : ""}">
      <span class="idx">${String(i + 1).padStart(2, "0")}</span>
      <span class="rdot" style="background:${HEALTH_COLOR[gs.health]}"></span>
      <span class="rname">${esc(d.name)}</span>
      <span class="rtbl">${isRag ? "→ 工研院多模態RAG" : esc(d.ragic_table)}</span>
      <span class="rst">${esc(st)}</span>
      <span class="rtm">${esc(fmtActivity(d.last_activity, agg.as_of))}</span>
    </div>`;
  }).join("");

  const soRows = agg.groups.map((gs) => {
    const d = gs.department;
    const ts = data.tickets.filter((t) => t.department_id === d.department_id);
    const low = ts.find((t) => t.needs_review);
    let draft: string, status: string, action: string;
    if (gs.health === "red" || ts.length === 0) {
      draft = `<div class="d2" style="color:var(--ink-3)">連續 3 天無新訊息，無待簽核草稿——系統自動轉逾時警示，列入待複核清單</div>`;
      status = `<span class="pill danger"><span class="dot"></span>逾時警示</span>`;
      action = `前往處理`;
    } else {
      const extra = ts.length > 1 ? `<span class="rsub">另 ${ts.length - 1} 筆同群組草稿</span>` : "";
      const isub = low ? `<div class="isub">⚠ 另 1 筆「門壞了」車號部位無法對應，已即時攔截，須人工補資訊</div>` : "";
      draft = `<div class="d2"><b>${esc(ts[0].summary)}</b>${isub}${extra}</div>`;
      if (gs.signed_off) { status = `<span class="pill ok"><span class="dot"></span>已簽核</span>`; action = `✓ ${esc(ts[0].confirmed_by ?? "")} ${esc(fmtActivity(ts[0].confirmed_at ?? agg.as_of, agg.as_of))}`; }
      else if (low) { status = `<span class="pill danger"><span class="dot"></span>1 筆低信心</span>`; action = `展開複核`; }
      else { status = `<span class="pill warn"><span class="dot"></span>待簽核</span>`; action = `確認今日進度`; }
    }
    return `<tr><td class="g2">${esc(d.name)}</td><td>${draft}</td><td>${confBars(worstConf(ts))}</td><td>${status}</td><td>${action}</td></tr>`;
  }).join("");

  const ill = data.illustrative;
  const chat = (ill?.chat ?? []).map((c) => c.role === "you"
    ? `<div class="q2">${esc(c.text)}</div>`
    : `<div class="a2">${esc(c.text)}${c.cite ? `<br><span class="ci${c.itri ? " itri" : ""}">${esc(c.cite)}</span>` : ""}</div>`).join("");
  const KIND: Record<string, string> = { img: "image", vid: "video", pdf: "pdf", csv: "csv" };
  const KL: Record<string, string> = { img: "圖片", vid: "影片", pdf: "文件", csv: "表格" };
  const assets = (ill?.assets ?? []).map((a) =>
    `<div class="amrow"><span class="ai2">${icon(KIND[a.kind], 16)}</span><div><div class="an">${esc(a.name)}</div><div class="as">${KL[a.kind]}</div></div><span class="ag">${esc(a.group)}</span></div>`).join("");
  const pins = (ill?.geo ?? []).map((p) => `<div class="pin2${p.big ? " big" : ""}" style="left:${p.x}%;top:${p.y}%"></div>`).join("");
  const gstat = ill?.geo_stats;

  const body = `${FUKU_MAST(agg.as_of, "總經理室", "tenant_admin・全群組總覽", "戰情室")}
<div class="wrap">
  <div class="sheet">
    <div class="bs-name">
      <div><div class="kicker">台灣福祉科技 · 智慧工廠治理日報</div><h1>現場治理總覽</h1></div>
      <div class="dateline">${esc(agg.as_of.slice(0, 10))}　${esc(agg.as_of.slice(11, 16))}<br>特種車輛改裝廠 · 復康巴士／福祉車／到宅沐浴車<br>檢視身份：總經理室 · tenant_admin</div>
    </div>

    <div class="lead">
      <div class="prose">
        <div class="eyebrow" style="color:var(--terra)">§ I　治理摘要</div>
        <p>今日六大群組，<b>${agg.signed_groups}</b> 組已完成人工簽核（<span class="fig">${pct(agg.signoff_rate)}%</span><sup>1</sup>）、<b>${agg.green_groups}</b> 組亮綠燈（<span class="fig">${pct(agg.health_rate)}%</span><sup>2</sup>）；AI 對今日 <b>${agg.high_conf_den}</b> 筆判讀標記 <b>${agg.high_conf_num}</b> 筆高信心（<span class="fig t">${pct(agg.high_conf_ratio)}%</span><sup>3</sup>）——其餘刻意標低、交人工複核，<b>不讓 AI 用猜的硬寫進正式系統</b>。</p>
        <div class="notes"><b>¹</b> 已簽核群組 ÷ 6（tickets.confirm_status 依 department 聚合）　　<b>²</b> 綠燈群組 ÷ 6（近 24h 有活動且未逾時）<br><b>³</b> high 筆數 ÷ 當日已標信心度總數（tickets.confidence）——刻意不美化，誠實反映把握程度</div>
      </div>
      <div class="meters">
        ${meter("本日簽核完成率", agg.signoff_rate, `${agg.signed_groups} / 6 群組`, "var(--pine)")}
        ${meter("六群組整體健康度", agg.health_rate, `${agg.green_groups} 綠 · ${yellow} 黃 · ${red} 紅`, "var(--pine-2)")}
        ${meter("今日 AI 高信心比例", agg.high_conf_ratio, `${agg.high_conf_num} / ${agg.high_conf_den} 筆`, "var(--terra)")}
      </div>
    </div>

    <div class="opsrow">
      <div class="op"><span class="ov serif">${agg.metrics.monthly_service_tickets}</span><span class="ol">本月維修工單</span><span class="os">CRM_service_tickets</span></div>
      <div class="op"><span class="ov serif">${agg.metrics.km_documents}</span><span class="ol">知識庫累積文件</span><span class="os">RAG 索引</span></div>
      <div class="op"><span class="ov serif" style="color:var(--terra)">${agg.metrics.pending_review}</span><span class="ol">待人工確認</span><span class="os">pending_review</span></div>
    </div>

    <div class="bs-sec"><span class="no">§ II</span><h2>六大 LINE 群組名冊</h2><span class="note">系統輸入端 · 各群組對應一張 Ragic 資料表</span></div>
    <div class="bs-hr"></div>
    <div class="reg">${regRows}</div>

    <div class="bs-sec"><span class="no">§ III</span><h2>每日簽核</h2><span class="note">Human-in-the-loop · 簽核後才寫入 Ragic · 逾 24h 自動轉逾時警示</span></div>
    <table class="so2"><thead><tr><th>群組</th><th>AI 今日草稿摘要</th><th>信心</th><th>狀態</th><th>簽核</th></tr></thead><tbody>${soRows}</tbody></table>

    <div class="bs-sec"><span class="no">附錄</span><h2>多模態證據與檢索</h2><span class="note">文字 · 照片 · 影片 · 文件 · 皆標來源群組</span></div>
    <div class="apx">
      <div class="col"><div class="ch">${icon("search")}智慧檢索 · 對話</div>${chat}</div>
      <div class="col"><div class="ch">${icon("csv")}多模態素材看板</div>${assets}</div>
      <div class="col"><div class="ch">${icon("image")}全台服務涵蓋</div>
        <div class="m2c"><svg class="map" viewBox="0 0 120 150" preserveAspectRatio="xMidYMid meet"><path d="M62 8 C74 16 82 30 84 48 C86 66 82 88 74 112 C68 130 60 144 52 150 C46 144 40 130 38 112 C34 90 34 66 40 48 C46 28 52 14 62 8 Z" fill="#DDE4D6" stroke="#C6D0BC" stroke-width="1.2"/></svg>${pins}</div>
        <div class="mleg"><b>${gstat?.points ?? 0}</b> 服務據點 · <b>${gstat?.cities ?? 0}</b> 縣市 · <span style="color:var(--terra)">● ${esc(gstat?.hq ?? "")}</span></div>
      </div>
    </div>

    <div class="bs-foot"><span>台灣福祉科技 × Ragic × 工研院多模態 RAG · 全地端部署 · 示範資料・姓名已假名化</span><span style="margin-left:auto">資料源 tickets / CRM_service_tickets / pending_review · 角色 tenant_admin</span></div>
  </div>
</div>`;
  return doc("台灣福祉 AI 智慧戰情室 — 治理日報 v8", body, V8_CSS);
}

const FUKU_MAST = (asOf: string, roleB: string, roleS: string, onTab: string): string => `
<div class="mast">
  <div class="crest">福</div><div class="wm"><b>台灣福祉科技</b><span>AI 智慧管理戰情室</span></div>
  <nav>${["戰情室", "每日簽核", "知識檢索", "Ragic 總台"].map((t) => `<a class="${t === onTab ? "on" : ""}" href="#">${t}</a>`).join("")}</nav>
  <div class="right">
    <div class="eng"><span class="dot" style="background:#9FD6B4"></span>AI 引擎・07:30 批次完成</div>
    <div class="clock">${esc(asOf.slice(0, 10))}　${esc(asOf.slice(11, 16))}</div>
    <div class="role"><b>${esc(roleB)}</b><span>${esc(roleS)}</span></div>
  </div>
</div>`;

// ───────────────────────── tenant_admin ─────────────────────────
export function renderTenantAdmin(data: WarRoomData, agg: Aggregate): string {
  const g = (id: string): GroupStatus => agg.groups.find((x) => x.department.department_id === id)!;

  const gauges = `<div class="card gauges">
    <div class="gauge"><div class="ring">${ring(agg.signoff_rate, "var(--pine)")}<div class="ctr"><div class="val serif">${pct(agg.signoff_rate)}<small>%</small></div><div class="frac">${agg.signed_groups} / 6 群組</div></div></div><div class="lbl">本日簽核完成率</div><div class="calc">已簽核群組 ÷ 6</div></div>
    <div class="gauge"><div class="ring">${ring(agg.health_rate, "var(--pine-2)")}<div class="ctr"><div class="val serif">${pct(agg.health_rate)}<small>%</small></div><div class="frac">${agg.green_groups} 綠 · ${agg.groups.filter((x) => x.health === "yellow").length} 黃 · ${agg.groups.filter((x) => x.health === "red").length} 紅</div></div></div><div class="lbl">六群組整體健康度</div><div class="calc">綠燈群組 ÷ 6</div></div>
    <div class="gauge"><div class="ring">${ring(agg.high_conf_ratio, "var(--terra)")}<div class="ctr"><div class="val serif">${pct(agg.high_conf_ratio)}<small>%</small></div><div class="frac">${agg.high_conf_num} / ${agg.high_conf_den} 筆</div></div></div><div class="lbl">今日 AI 高信心比例</div><div class="calc">high 筆數 ÷ 當日已分類</div></div>
  </div>`;

  const govSide = `<div class="card gov-side">
    <div class="eyebrow" style="color:var(--terra)">治理原則</div>
    <p><b>AI 不自己說了算。</b>所有分析結果在部門負責人簽核前僅為草稿，不寫入 Ragic 正式報表。<b>${pct(agg.high_conf_ratio)}% 是刻意不做高的誠實值</b>——看不太懂的內容一律標低信心、攔下來人工複核，不讓 AI 用猜的硬寫。</p>
    <div class="metrics">
      <div class="m"><div class="mv serif">${agg.metrics.monthly_service_tickets}<small>件</small></div><div class="ml">本月維修工單<span class="src">CRM_service_tickets</span></div></div>
      <div class="m"><div class="mv serif">${agg.metrics.km_documents}<small>份</small></div><div class="ml">知識庫累積文件<span class="src">多模態 RAG 索引</span></div></div>
      <div class="m"><div class="mv serif" style="color:var(--terra)">${agg.metrics.pending_review}<small>筆</small></div><div class="ml">待人工確認<span class="src">pending_review</span></div></div>
    </div>
  </div>`;

  const groupsBand = agg.groups.map((gs) => {
    const d = gs.department;
    const isRag = d.ragic_table.includes("工研院");
    const st = gs.health === "red" ? "逾時警示 · 無新活動"
      : gs.signed_off ? `已簽核${isRag ? " · 已同步 RAG" : ""}`
      : gs.has_low_pending ? "低信心待補"
      : `正常處理中 · 今日 ${gs.today_total} 則`;
    const tbl = isRag
      ? `<span class="tbl" style="color:var(--terra);background:var(--terra-tint)">→ 工研院多模態RAG</span>`
      : `<span class="tbl">${esc(d.ragic_table)}</span>`;
    return `<div class="grp${gs.health === "red" ? " alert" : ""}">
      <div class="top"><span class="dot" style="background:${HEALTH_COLOR[gs.health]}"></span><span class="nm">${esc(d.name)}</span></div>
      ${tbl}<div class="st">${esc(st)}</div><div class="tm">更新 ${esc(fmtActivity(d.last_activity, agg.as_of))}</div>
    </div>`;
  }).join("");

  const signoffRows = agg.groups.map((gs) => {
    const d = gs.department;
    const ts = data.tickets.filter((t) => t.department_id === d.department_id);
    const first = ts[0];
    const low = ts.find((t) => t.needs_review);
    let draft: string, confCell: string, statusPill: string, action: string;
    if (gs.health === "red" || ts.length === 0) {
      draft = `<div class="draft" style="color:var(--ink-3)">連續 3 天無新訊息，無待簽核草稿 — 系統自動轉逾時警示，列入待複核清單</div>`;
      confCell = `<span style="color:var(--ink-3);font-size:11px">—</span>`;
      statusPill = `<span class="pill danger"><span class="dot"></span>逾時警示</span>`;
      action = `<span class="btn-sign" style="background:var(--terra)">前往處理</span>`;
    } else {
      const extra = ts.length > 1 ? `　<span style="color:var(--ink-3)">・另 ${ts.length - 1} 筆</span>` : "";
      const sub = low ? `<div class="sub">另 1 筆「門壞了」因車號與部位無法對應，<b style="color:var(--terra)">已即時攔截</b>，需人工補資訊</div>`
        : d.ragic_table.includes("工研院") ? `<div class="sub">已同步工研院多模態 RAG 知識庫</div>` : "";
      draft = `<div class="draft"><b>${esc(first.summary)}</b>${extra}${sub}</div>`;
      confCell = confBars(worstConf(ts));
      if (gs.signed_off) {
        statusPill = `<span class="pill ok"><span class="dot"></span>已簽核</span>`;
        action = `<span class="btn-done">✓ ${esc(first.confirmed_by ?? "")} ${esc(fmtActivity(first.confirmed_at ?? agg.as_of, agg.as_of))}</span>`;
      } else if (low) {
        statusPill = `<span class="pill danger"><span class="dot"></span>1 筆低信心</span>`;
        action = `<span class="btn-sign">展開複核</span>`;
      } else {
        statusPill = `<span class="pill warn"><span class="dot"></span>待簽核</span>`;
        action = `<span class="btn-sign">確認今日進度</span>`;
      }
    }
    return `<tr><td class="grp2">${esc(d.name)}</td><td>${draft}</td><td>${confCell}</td><td>${statusPill}</td><td style="text-align:right">${action}</td></tr>`;
  }).join("");

  const ill = data.illustrative;
  const chat = (ill?.chat ?? []).map((c) =>
    c.role === "you" ? `<div class="bubble q">${esc(c.text)}</div>`
      : `<div class="bubble a">${esc(c.text)}${c.cite ? `<span class="cite${c.itri ? " itri" : ""}">${esc(c.cite)}</span>` : ""}</div>`,
  ).join("\n");
  const ICON: Record<string, string> = { img: "🖼️", vid: "🎬", pdf: "📄", csv: "📊" };
  const KIND: Record<string, string> = { img: "圖片", vid: "影片", pdf: "文件", csv: "表格" };
  const assets = (ill?.assets ?? []).map((a) =>
    `<div class="asset"><div class="th ${a.kind}">${ICON[a.kind]}</div><div class="m3"><div class="t">${esc(a.name)}</div><div class="s">${KIND[a.kind]} · 來源群組 <span class="g">${esc(a.group)}</span></div></div></div>`,
  ).join("\n");
  const pins = (ill?.geo ?? []).map((p) =>
    `<div class="pin${p.big ? " big" : ""}" style="left:${p.x}%;top:${p.y}%"><div class="d3"></div></div>`,
  ).join("");
  const gs2 = ill?.geo_stats;

  const body = `${FUKU_MAST(agg.as_of, "總經理室", "tenant_admin・全群組總覽", "戰情室")}
<div class="wrap">
  <div class="titlebar"><div><div class="eyebrow">Command Center · 特種車輛改裝廠</div><h1>現場治理總覽</h1></div>
    <div class="sub">復康巴士 · 福祉車 · 到宅沐浴車</div>
    <div class="flag"><span class="dot" style="background:var(--terra)"></span>畫面每一個數字皆可回溯至來源資料表</div></div>
  <div class="gov">${gauges}${govSide}</div>
  <div class="card"><div class="c-hd"><h2>六大 LINE 群組即時狀態</h2><span class="note">系統輸入端 · 各群組對應一張 Ragic 資料表</span></div><div class="rule"></div><div class="groups">${groupsBand}</div></div>
  <div class="card signoff"><div class="c-hd"><h2>每日簽核面板</h2><span class="pill pine" style="margin-left:12px"><span class="dot"></span>簽核後才寫入 Ragic</span><span class="note">Human-in-the-loop · 逾 24 小時未簽核自動轉紅燈</span></div>
    <table><thead><tr><th>群組</th><th>AI 今日草稿摘要</th><th>信心分佈</th><th>狀態</th><th style="text-align:right">簽核</th></tr></thead><tbody>${signoffRows}</tbody></table></div>
  <div class="trio">
    <div class="card"><div class="c-hd"><h2>智慧檢索 · 對話</h2><span class="note">多模態 RAG · 回答標記來源</span></div><div class="rule"></div>
      <div class="chat-body">${chat}</div><div class="chat-in">向 AI 大腦提問…<span class="send">↑</span></div></div>
    <div class="card"><div class="c-hd"><h2>多模態素材看板</h2></div><div class="rule"></div><div class="assets">${assets}</div></div>
    <div class="card"><div class="c-hd"><h2>全台服務涵蓋</h2><span class="note">終端客戶分布</span></div><div class="rule"></div>
      <div class="map"><div class="map-canvas"><svg viewBox="0 0 120 176" preserveAspectRatio="xMidYMid meet"><path d="M62 12 C74 20 82 34 84 52 C86 72 82 96 74 122 C68 142 60 160 52 166 C46 160 40 146 38 128 C34 104 34 78 40 54 C46 32 52 18 62 12 Z" fill="#DDE4D6" stroke="#C6D0BC" stroke-width="1.2"/></svg>${pins}</div>
      <div class="legend2"><span><b>${gs2?.points ?? 0}</b> 服務據點</span><span><b>${gs2?.cities ?? 0}</b> 縣市</span><span style="color:var(--terra)">● ${esc(gs2?.hq ?? "")}</span></div></div></div>
  </div>
  <footer><span>台灣福祉科技 × Ragic × 工研院多模態 RAG　·　全地端部署　·　示範資料・姓名已假名化</span>
    <span class="mono" style="margin-left:auto">資料源：tickets / CRM_service_tickets / pending_review　·　登入角色 tenant_admin</span></footer>
</div>`;
  return doc("台灣福祉 AI 智慧戰情室 — 總經理室", body);
}

// ───────────────────────── aiproot_admin ─────────────────────────
const STATUS_COLOR: Record<string, string> = {
  "準備中": "var(--ink-3)", "已送件": "var(--warn)", "審查中": "#7FA9C9",
  "已核准": "var(--ok)", "已撥款": "var(--pine)",
};

function funnelStage(m: SubsidyMeasure): string {
  const total = m.stages.reduce((s, x) => s + (x.n ?? 0), 0) || 1;
  const bars = m.stages.filter((s) => s.n).map((s) =>
    `<i style="background:${STATUS_COLOR[s.status] ?? "var(--well)"};width:${((s.n ?? 0) / total) * 100}%"></i>`).join("");
  const rows = m.stages.map((s) =>
    `<div class="stat"${s.n === null ? ' style="color:var(--ink-3)"' : ""}><span class="sd" style="background:${s.n === null ? "var(--well)" : STATUS_COLOR[s.status] ?? "var(--well)"}"></span>${s.n === null ? "—" : esc(s.status)}<span class="sn"${s.n === null ? ' style="color:var(--ink-3)"' : ""}>${s.n ?? "—"}</span></div>`).join("");
  return `<div class="stage"><div class="sh">${esc(m.measure)}<small>${esc(m.desc)}</small></div><div class="bar">${bars}</div>${rows}</div>`;
}

export function renderAiproot(a: AiprootData, homeCareAgg: Aggregate): string {
  const tenantRows = a.tenants.map((t) => {
    const health = t.is_home_care ? homeCareAgg.groups.map((g) => g.health) : t.health;
    const label = t.is_home_care
      ? `${homeCareAgg.green_groups}綠${homeCareAgg.groups.filter((g) => g.health === "yellow").length}黃${homeCareAgg.groups.filter((g) => g.health === "red").length}紅`
      : t.health_label;
    const toneCls = t.subsidy_tone === "pine" ? "pine" : t.subsidy_tone === "warn" ? "warn" : "ghost";
    const online = t.onboard_status !== "洽談中";
    const statusPill = t.onboard_status === "正式上線" ? `<span class="pill ok"><span class="dot"></span>正式上線</span>`
      : t.onboard_status === "測試中" ? `<span class="pill terra"><span class="dot"></span>測試中</span>`
      : `<span class="pill ghost"><span class="dot" style="background:var(--ink-3)"></span>洽談中</span>`;
    const healthCell = online
      ? `<span class="health">${health.map((h) => `<span class="h" style="background:${HEALTH_COLOR[h]}"></span>`).join("")}<span class="locknote">${esc(label)}</span></span>`
      : `<span class="locknote" style="margin:0;color:var(--ink-3)">尚未導入</span>`;
    const seatCell = t.seats_used !== null
      ? `<span class="seat">${t.seats_used} / ${t.seats_total} 席</span><div class="seatbar"><i style="width:${(t.seats_used / (t.seats_total ?? 1)) * 100}%"></i></div>`
      : `<span class="mono" style="color:var(--ink-3)">—</span>`;
    return `<tr>
      <td class="co"><b>${esc(t.name)}</b><div class="ind">${esc(t.industry)}</div></td>
      <td>${statusPill}</td>
      <td><span class="pill ${toneCls}"${toneCls === "pine" ? ' style="color:var(--pine);background:var(--pine-tint)"' : ""}>${toneCls === "ghost" ? '<span class="dot" style="background:var(--ink-3)"></span>' : '<span class="dot"></span>'}${esc(t.subsidy)}</span></td>
      <td>${healthCell}</td>
      <td>${seatCell}</td>
      <td class="mono" style="font-size:11.5px;color:${online ? "var(--ink-2)" : "var(--ink-3)"}">${esc(t.last_activity)}</td>
      <td class="act" style="text-align:right">${online ? '<span class="go">進入 →</span>' : '<span class="na">洽談中</span>'}</td>
    </tr>`;
  }).join("\n");

  const body = `
<div class="mast">
  <div class="crest">ai</div><div class="wm"><b>aiproot</b><span>智慧工廠戰情室・系統商控制台</span></div>
  <nav>${["客戶案場", "補助申請", "License 授權", "系統健康"].map((t, i) => `<a class="${i === 0 ? "on" : ""}" href="#">${t}</a>`).join("")}</nav>
  <div class="right"><div class="clock">${esc(a.as_of.slice(0, 10))}　${esc(a.as_of.slice(11, 16))}</div><div class="role"><b>系統管理員</b><span>aiproot_admin・跨租戶</span></div></div>
</div>
<div class="wrap">
  <div class="titlebar"><div><div class="eyebrow">Multi-Tenant · 系統商視角</div><h1>客戶案場總覽</h1></div><div class="sub">${a.total_pipeline} 家排隊導入 · 分階段上線</div></div>
  <div class="isolation"><div class="lock">🔒</div><div class="t">租戶隔離：系統商僅檢視聚合統計與健康度燈號<span>不顯示任何客戶的對話內容、簽核明細或營運資料——API 層即不回傳 summary 欄位，非前端隱藏</span></div><div class="tag">role = aiproot_admin · 僅 COUNT / GROUP BY</div></div>
  <div class="top">
    <div class="kpis">
      <div class="kcol"><div class="card kpi"><div class="kl">正式上線案場</div><div class="kv serif">${a.counts.online}<small>家</small></div><div class="ks">onboard_status='正式上線'</div></div>
        <div class="card kpi"><div class="kl">測試中</div><div class="kv serif">${a.counts.testing}<small>家</small></div><div class="ks">onboard_status='測試中'</div></div></div>
      <div class="kcol"><div class="card kpi"><div class="kl">洽談中客戶</div><div class="kv serif">${a.counts.talking}<small>家</small></div><div class="ks">onboard_status='洽談中'</div></div>
        <div class="card kpi"><div class="kl">補助申請中</div><div class="kv serif" style="color:var(--terra)">${a.counts.subsidy_active}<small>案</small></div><div class="ks">未核准/未撥款 distinct</div></div></div>
    </div>
    <div class="card funnel"><div class="c-hd" style="padding:0"><h2>補助申請漏斗</h2><span class="note">產業競爭力輔導團 · 依 subsidy_applications.measure + status 分組計數</span></div>
      <div class="stages">${a.funnel.map(funnelStage).join("")}</div></div>
  </div>
  <div class="card"><div class="c-hd"><h2>客戶案場清單</h2><span class="pill ghost" style="margin-left:10px"><span class="dot" style="background:var(--ink-3)"></span>燈號彙總，不含內容</span><span class="note">tenants ＋ licenses ＋ tickets 聚合統計</span></div><div class="rule"></div>
    <table class="tbl2"><thead><tr><th>客戶案場</th><th>導入狀態</th><th>補助階段</th><th>六群組健康度（燈號彙總）</th><th>License 用量</th><th>最近活動</th><th style="text-align:right">操作</th></tr></thead><tbody>${tenantRows}</tbody></table>
    <div class="t-more">顯示 ${a.tenants.length} / ${a.total_pipeline} 家 · 另 ${a.total_pipeline - a.tenants.length} 家洽談中未上線　·　點「進入」以 aiproot_admin 權限檢視：僅健康度與統計，對話內容與簽核明細區塊不渲染</div></div>
  <footer><span>aiproot 系統商控制台　·　全地端部署　·　客戶營運內容不外流</span>
    <span class="mono" style="margin-left:auto">資料源：tenants / licenses / subsidy_applications / tickets（聚合）　·　登入角色 aiproot_admin</span></footer>
</div>`;
  return doc("aiproot 客戶案場總覽", body);
}

// ───────────────────────── group_owner ─────────────────────────
export function renderGroupOwner(data: WarRoomData, agg: Aggregate, departmentId: string): string {
  const g = agg.groups.find((x) => x.department.department_id === departmentId);
  if (!g) throw new Error(`department ${departmentId} not found`);
  const dept = g.department;
  const tickets = data.tickets.filter((t) => t.department_id === departmentId);
  const lowCount = tickets.filter((t) => t.needs_review).length;
  const statusPill = g.signed_off ? `<span class="pill ok"><span class="dot"></span>已簽核</span>`
    : lowCount > 0 ? `<span class="pill danger"><span class="dot"></span>${lowCount} 筆低信心待補</span>`
    : `<span class="pill warn"><span class="dot"></span>待簽核</span>`;
  const rows = tickets.map((t) => `<tr class="${t.needs_review ? "flag" : ""}">
    <td class="tid mono">${esc(t.ticket_id)}</td><td class="cat">${esc(t.category)}</td>
    <td class="sum">${esc(t.summary)}${t.needs_review ? '<div class="intercept">⚠ 低信心・已即時攔截，需人工補資訊後才可簽核</div>' : ""}${t.linked_ref ? `<span class="ref mono">${esc(t.linked_ref)}</span>` : ""}</td>
    <td class="cf">${confBars(t.confidence)}</td><td class="mc mono">${t.message_count} 則</td></tr>`).join("\n");

  const body = `${FUKU_MAST(agg.as_of, `${dept.name}組長`, "group_owner・僅本群組・可簽核", "每日簽核")}
<div class="wrap">
  <div class="titlebar"><div><div class="eyebrow">每日簽核 · 部門負責人</div><h1>${esc(dept.name)}・今日待簽核</h1></div>
    <div class="sub">Human-in-the-loop · 逾 24 小時未簽核自動轉逾時警示</div><div class="tbl">→ ${esc(dept.ragic_table)}</div></div>
  <div class="card summary">
    <div class="sm"><div class="l">今日草稿</div><div class="v serif">${tickets.length}<small>筆</small></div><div class="s">${esc(dept.ragic_table)}</div></div>
    <div class="sm"><div class="l">高信心</div><div class="v serif">${g.high_count}<small>筆</small></div><div class="s">可直接簽核</div></div>
    <div class="sm"><div class="l">低信心攔截</div><div class="v serif" style="color:var(--terra)">${lowCount}<small>筆</small></div><div class="s">needs_review=true</div></div>
    <div class="sm action"><div class="note">${statusPill}　簽核後才寫入 Ragic，<b>低信心項目須先補資訊</b></div><div class="btn-lg">確認今日進度（${tickets.length - lowCount} 筆）</div></div>
  </div>
  <div class="card"><div class="c-hd"><h2>AI 今日草稿明細</h2><span class="pill" style="color:var(--pine);background:var(--pine-tint);margin-left:8px"><span class="dot"></span>只有本群組負責人可簽核</span><span class="note">每筆標示 AI 判讀信心度</span></div><div class="rule"></div>
    <table class="tbl2"><thead><tr><th>編號</th><th>類別</th><th>AI 草稿摘要</th><th>信心度</th><th>訊息數</th></tr></thead><tbody>${rows}</tbody></table></div>
  <footer><span>示範資料・姓名與車號已假名化（raw_messages.user_id 假名化處理）　·　簽核後 sync_to_ragic=true</span>
    <span class="mono" style="margin-left:auto">資料源：tickets WHERE department_id='${esc(departmentId)}'　·　登入角色 group_owner　·　全群組簽核 ${agg.signed_groups}/6（${pct(agg.signoff_rate)}%）</span></footer>
</div>`;
  return doc(`${dept.name}・每日簽核 — group_owner`, body);
}

// ───────────────────────── tenant_admin v9（Blueprint 工程藍圖）─────────────────────────
// 全新配色/材質：冷石板底 + 外露量測格線 + 藍圖藍 + 角落刻度 + mono 數據。自成一體，不共用 STYLES。
export function renderTenantAdminV9(data: WarRoomData, agg: Aggregate): string {
  const yellow = agg.groups.filter((x) => x.health === "yellow").length;
  const red = agg.groups.filter((x) => x.health === "red").length;
  const HC: Record<string, string> = { green: "var(--ok)", yellow: "var(--warn)", red: "var(--danger)", idle: "var(--ink-3)" };

  const meter = (label: string, ratio: number, sub: string, cls: string): string => {
    const p = pct(ratio);
    return `<div class="mrow">
      <div class="mtop"><span class="mlab">${label}</span><span class="mval mono">${p}<i>%</i></span></div>
      <div class="mbar"><span class="mfill ${cls}" style="width:${p}%"></span></div>
      <div class="msub mono">${sub}</div>
    </div>`;
  };

  const reg = agg.groups.map((gs, i) => {
    const d = gs.department;
    const isRag = d.ragic_table.includes("工研院");
    const st = gs.health === "red" ? "逾時警示・連續無新活動"
      : gs.signed_off ? `已簽核${isRag ? "・已同步工研院 RAG" : ""}`
      : gs.has_low_pending ? "低信心待補，需人工補資訊"
      : `正常處理中・今日 ${gs.today_total} 則`;
    return `<div class="rr${gs.health === "red" ? " alert" : ""}">
      <span class="ri mono">${String(i + 1).padStart(2, "0")}</span>
      <span class="rdot" style="background:${HC[gs.health]}"></span>
      <span class="rn">${esc(d.name)}</span>
      <span class="rt mono">${isRag ? "→ 工研院多模態RAG" : esc(d.ragic_table)}</span>
      <span class="rs">${esc(st)}</span>
      <span class="rtm mono">${esc(fmtActivity(d.last_activity, agg.as_of))}</span>
    </div>`;
  }).join("");

  const confTag = (c: Ticket["confidence"]): string => {
    const m: Record<string, [string, string]> = { high: ["HIGH", "var(--ok)"], medium: ["MED", "var(--warn)"], low: ["LOW", "var(--danger)"] };
    if (!c) return `<span class="ct mono" style="color:var(--ink-3)">—</span>`;
    const [t, col] = m[c];
    return `<span class="ct mono" style="color:${col}">▍${t}</span>`;
  };

  const soRows = agg.groups.map((gs) => {
    const d = gs.department;
    const ts = data.tickets.filter((t) => t.department_id === d.department_id);
    const low = ts.find((t) => t.needs_review);
    let draft: string, status: string, action: string;
    if (gs.health === "red" || ts.length === 0) {
      draft = `<span style="color:var(--ink-3)">連續 3 天無新訊息，無待簽核草稿——系統自動轉逾時警示</span>`;
      status = `<span class="pl danger">逾時警示</span>`; action = "前往處理";
    } else {
      const extra = ts.length > 1 ? `<span class="rsub mono">＋${ts.length - 1} 筆</span>` : "";
      const isub = low ? `<div class="isub">⚠ 另 1 筆「門壞了」車號部位無法對應，已即時攔截，須人工補資訊</div>` : "";
      draft = `<b>${esc(ts[0].summary)}</b>${extra}${isub}`;
      if (gs.signed_off) { status = `<span class="pl ok">已簽核</span>`; action = `✓ ${esc(ts[0].confirmed_by ?? "")} ${esc(fmtActivity(ts[0].confirmed_at ?? agg.as_of, agg.as_of))}`; }
      else if (low) { status = `<span class="pl danger">1 筆低信心</span>`; action = "展開複核"; }
      else { status = `<span class="pl warn">待簽核</span>`; action = "確認今日進度"; }
    }
    return `<tr><td class="g2">${esc(d.name)}</td><td class="dc">${draft}</td><td>${confTag(worstConf(ts))}</td><td>${status}</td><td class="ac">${action}</td></tr>`;
  }).join("");

  const ill = data.illustrative;
  const chat = (ill?.chat ?? []).map((c) => c.role === "you"
    ? `<div class="q9 mono">&gt; ${esc(c.text)}</div>`
    : `<div class="a9">${esc(c.text)}${c.cite ? `<span class="ci mono">└ ${esc(c.cite)}</span>` : ""}</div>`).join("");
  const KIND: Record<string, string> = { img: "image", vid: "video", pdf: "pdf", csv: "csv" };
  const KL: Record<string, string> = { img: "IMG", vid: "VID", pdf: "PDF", csv: "CSV" };
  const assets = (ill?.assets ?? []).map((a) =>
    `<div class="ar"><span class="ai">${icon(KIND[a.kind], 15)}</span><span class="an">${esc(a.name)}</span><span class="ak mono">${KL[a.kind]}·${esc(a.group)}</span></div>`).join("");
  const pins = (ill?.geo ?? []).map((p) => `<span class="pn${p.big ? " big" : ""}" style="left:${p.x}%;top:${p.y}%"></span>`).join("");
  const gs2 = ill?.geo_stats;
  const D = agg.as_of.slice(0, 10), T = agg.as_of.slice(11, 16);

  const css = `
  :root{--paper:#EEF1F4;--sheet:#F8FAFB;--well:#EAEEF2;--ink:#1B2733;--ink-2:#55636E;--ink-3:#8996A1;
    --line:#D3DAE1;--line-2:#E4E9EE;--blue:#2D5B8E;--blue-2:#3E74AE;--blue-tint:#E4ECF5;
    --amber:#B8791C;--ok:#2C7A6B;--warn:#B8791C;--danger:#C0492E;
    --gr:"Helvetica Neue",-apple-system,"PingFang TC","Noto Sans TC",sans-serif;--mono:"SF Mono",ui-monospace,Menlo,monospace;}
  *{margin:0;padding:0;box-sizing:border-box}html,body{width:1600px}
  body{font-family:var(--gr);color:var(--ink);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;
    background:var(--paper);
    background-image:linear-gradient(var(--blue-tint) 1px,transparent 1px),linear-gradient(90deg,var(--blue-tint) 1px,transparent 1px);
    background-size:28px 28px;background-position:-1px -1px;}
  .mono{font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
  .lab{font-family:var(--mono);font-size:10px;letter-spacing:.18em;color:var(--blue);text-transform:uppercase}
  /* masthead */
  .mh{display:flex;align-items:center;gap:16px;padding:0 32px;height:52px;background:var(--sheet);border-bottom:2px solid var(--blue)}
  .mh .mk{width:24px;height:24px;border:2px solid var(--blue);color:var(--blue);font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;font-family:var(--gr)}
  .mh b{font-size:14px;font-weight:600;letter-spacing:.02em}.mh .sub{font-size:10.5px;color:var(--ink-3);font-family:var(--mono);letter-spacing:.05em}
  .mh nav{display:flex;gap:2px;margin-left:14px;height:100%}
  .mh nav a{display:flex;align-items:center;padding:0 13px;font-size:12.5px;color:var(--ink-3);text-decoration:none;position:relative}
  .mh nav a.on{color:var(--blue);font-weight:600}.mh nav a.on::after{content:"";position:absolute;left:13px;right:13px;bottom:0;height:2px;background:var(--blue)}
  .mh .rt{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--ink-2);text-align:right;line-height:1.5}
  .mh .rt b{color:var(--ink);font-weight:600}
  /* sheet */
  .wrap{padding:20px 32px 28px}
  .sheet{position:relative;background:var(--sheet);border:1px solid var(--line);box-shadow:0 1px 2px rgba(27,39,51,.05),0 14px 34px -26px rgba(27,39,51,.3)}
  .rc{position:absolute;width:11px;height:11px;border:1.5px solid var(--blue);opacity:.55;z-index:2}
  .rc.tl{top:-1px;left:-1px;border-right:0;border-bottom:0}.rc.tr{top:-1px;right:-1px;border-left:0;border-bottom:0}
  .rc.bl{bottom:-1px;left:-1px;border-right:0;border-top:0}.rc.br{bottom:-1px;right:-1px;border-left:0;border-top:0}
  /* title block */
  .tb{display:flex;align-items:stretch;border-bottom:1px solid var(--blue)}
  .tb .ttl{padding:18px 24px 15px;flex:1}
  .tb .lab{margin-bottom:8px}
  .tb h1{font-size:29px;font-weight:600;letter-spacing:-.01em;line-height:1}
  .tb .meta{border-left:1px solid var(--line);display:grid;grid-template-columns:auto auto;font-family:var(--mono);font-size:10.5px}
  .tb .meta div{padding:7px 14px;border-bottom:1px solid var(--line-2)}
  .tb .meta .k{color:var(--ink-3);border-right:1px solid var(--line-2)}.tb .meta .v{color:var(--ink);text-align:right}
  .tb .meta div:nth-last-child(-n+2){border-bottom:0}
  /* section head */
  .sh{display:flex;align-items:baseline;gap:10px;padding:14px 24px 3px}
  .sh .no{font-family:var(--mono);font-size:11px;color:var(--blue);font-weight:700}
  .sh h2{font-size:15px;font-weight:600;letter-spacing:.01em}.sh .nt{margin-left:auto;font-size:11px;color:var(--ink-3);font-family:var(--mono)}
  .hr{height:1px;background:var(--line);margin:8px 24px 0}
  /* lead */
  .lead{display:grid;grid-template-columns:1.7fr 1fr;border-bottom:1px solid var(--line)}
  .lead .pr{padding:16px 26px 15px;border-right:1px solid var(--line)}
  .lead .pr p{font-size:15.5px;line-height:1.95;color:var(--ink)}.lead .pr p b{font-weight:600}
  .fig{font-family:var(--mono);font-size:20px;font-weight:600;color:var(--blue);letter-spacing:-.02em}.fig.a{color:var(--amber)}
  .lead .pr sup{font-family:var(--mono);font-size:9px;color:var(--amber);vertical-align:super}
  .notes{margin-top:14px;padding-top:11px;border-top:1px dashed var(--line);font-family:var(--mono);font-size:10px;color:var(--ink-3);line-height:2}
  .notes b{color:var(--blue)}
  /* meters (measured scale — signature) */
  .mp{padding:15px 26px 12px}
  .mrow{padding:8px 0}
  .mtop{display:flex;align-items:baseline}.mlab{font-size:12px;color:var(--ink-2)}.mval{margin-left:auto;font-size:22px;font-weight:600;color:var(--ink)}.mval i{font-size:12px;color:var(--ink-3);font-style:normal;margin-left:1px}
  .mbar{position:relative;height:9px;margin:7px 0 4px;background:var(--paper);box-shadow:inset 0 0 0 1px var(--line);
    background-image:repeating-linear-gradient(90deg,transparent 0 calc(25% - 1px),var(--line) calc(25% - 1px) 25%)}
  .mfill{position:absolute;top:0;left:0;height:100%;display:block}
  .mfill.b{background:var(--blue)}.mfill.b2{background:var(--blue-2)}.mfill.a{background:var(--amber)}
  .msub{font-size:9.5px;color:var(--ink-3)}
  .ruler{display:flex;justify-content:space-between;font-family:var(--mono);font-size:8.5px;color:var(--ink-3);padding-top:5px;border-top:1px solid var(--line-2);margin-top:4px}
  /* ops strip */
  .ops{display:flex;border-bottom:1px solid var(--line);background:var(--well)}
  .ops .op{padding:11px 26px;display:flex;align-items:baseline;gap:8px}.ops .op+.op{border-left:1px solid var(--line)}
  .ops .ov{font-family:var(--mono);font-size:19px;font-weight:600}.ops .ol{font-size:11.5px;color:var(--ink-2)}.ops .os{font-family:var(--mono);font-size:9px;color:var(--ink-3);margin-left:auto;padding-left:14px}
  /* register */
  .rr{display:flex;align-items:center;gap:14px;padding:10px 24px;border-bottom:1px solid var(--line-2)}
  .rr:last-child{border-bottom:0}.rr .ri{font-size:11px;color:var(--ink-3);width:18px}
  .rr .rdot{width:8px;height:8px;flex:none}.rr .rn{font-weight:650;font-size:14px;width:92px}
  .rr .rt{font-size:11px;color:var(--blue);background:var(--blue-tint);padding:2px 7px}
  .rr .rs{margin-left:auto;font-size:12px;color:var(--ink-2)}.rr .rtm{font-size:11px;color:var(--ink-3);width:64px;text-align:right}
  .rr.alert{background:#F7E9E4}.rr.alert .rs{color:var(--danger);font-weight:600}
  /* sign-off table */
  table.so{width:100%;border-collapse:collapse;font-size:12.5px}
  .so th{text-align:left;font-family:var(--mono);font-size:10px;font-weight:600;color:var(--ink-3);letter-spacing:.08em;padding:8px 14px;border-bottom:1.5px solid var(--ink-2)}
  .so td{padding:11px 14px;border-bottom:1px solid var(--line-2);vertical-align:top}.so tr:last-child td{border-bottom:0}
  .so th:first-child,.so td:first-child{padding-left:24px}.so th:last-child,.so td:last-child{padding-right:24px;white-space:nowrap}
  .so td.g2{font-weight:650;white-space:nowrap}.so td.dc{color:var(--ink-2)}.so td.dc b{color:var(--ink);font-weight:600}
  .so .rsub{color:var(--ink-3);font-size:10.5px;margin-left:6px}.so .isub{color:var(--danger);font-size:11px;margin-top:4px;font-weight:600}
  .so td.ac{font-size:12px;color:var(--blue);font-weight:600}
  .ct{font-size:11px;font-weight:600}
  .pl{font-family:var(--mono);font-size:10.5px;font-weight:600;padding:1px 7px;border:1px solid currentColor}
  .pl.ok{color:var(--ok)}.pl.warn{color:var(--warn)}.pl.danger{color:var(--danger)}
  /* appendix */
  .apx{display:grid;grid-template-columns:1.25fr 1fr 1fr;border-top:1px solid var(--line)}
  .apx .col{padding:14px 22px 16px}.apx .col+.col{border-left:1px solid var(--line)}
  .apx .ch{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-bottom:11px}.apx .ch svg{color:var(--blue)}
  .q9{font-size:11.5px;color:var(--blue);text-align:right;margin-bottom:6px}
  .a9{font-size:12px;line-height:1.55;color:var(--ink);margin-bottom:9px}
  .a9 .ci{display:block;margin-top:3px;font-size:10px;color:var(--ink-3)}
  .ar{display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--line-2)}.ar:last-child{border-bottom:0}
  .ar .ai{color:var(--blue);flex:none}.ar .an{font-size:12px;font-weight:500}.ar .ak{margin-left:auto;font-size:9.5px;color:var(--ink-3)}
  .m9{position:relative;height:150px;background:var(--paper);border:1px solid var(--line);
    background-image:linear-gradient(var(--line-2) 1px,transparent 1px),linear-gradient(90deg,var(--line-2) 1px,transparent 1px);background-size:16px 16px}
  .m9 svg{position:absolute;inset:0;width:100%;height:100%}
  .pn{position:absolute;width:7px;height:7px;transform:translate(-50%,-50%);border:1.5px solid var(--amber)}
  .pn::before,.pn::after{content:"";position:absolute;background:var(--amber)}.pn::before{left:50%;top:-3px;width:1px;height:13px;transform:translateX(-50%)}.pn::after{top:50%;left:-3px;height:1px;width:13px;transform:translateY(-50%)}
  .pn.big{width:10px;height:10px}
  .mleg{margin-top:8px;font-family:var(--mono);font-size:10px;color:var(--ink-2)}.mleg b{color:var(--ink)}
  .ft{display:flex;padding:11px 24px;border-top:1px solid var(--line);font-family:var(--mono);font-size:10px;color:var(--ink-3)}`;

  const body = `
<div class="mh">
  <div class="mk">福</div><div><b>台灣福祉科技</b> <span class="sub">AI 戰情室</span></div>
  <nav><a class="on" href="#">戰情室</a><a href="#">每日簽核</a><a href="#">知識檢索</a><a href="#">Ragic 總台</a></nav>
  <div class="rt"><b>總經理室</b>　tenant_admin<br>${esc(D)} ${esc(T)}</div>
</div>
<div class="wrap">
  <div class="sheet">
    <span class="rc tl"></span><span class="rc tr"></span><span class="rc bl"></span><span class="rc br"></span>
    <div class="tb">
      <div class="ttl"><div class="lab">現場治理總覽 · 特種車輛改裝廠</div><h1>現場治理總覽</h1></div>
      <div class="meta">
        <div class="k">日期</div><div class="v">${esc(D)} ${esc(T)}</div>
        <div class="k">產線</div><div class="v">復康巴士/福祉車/沐浴車</div>
        <div class="k">檢視</div><div class="v">tenant_admin</div>
        <div class="k">狀態</div><div class="v" style="color:var(--ok)">● 整體正常</div>
      </div>
    </div>

    <div class="sh"><span class="no">§01</span><h2>治理摘要</h2><span class="nt">每個數字可回溯至來源表</span></div>
    <div class="hr"></div>
    <div class="lead">
      <div class="pr">
        <p>今日六大群組，<b>${agg.signed_groups}</b> 組已完成人工簽核（<span class="fig">${pct(agg.signoff_rate)}%</span><sup>1</sup>）、<b>${agg.green_groups}</b> 組亮綠燈（<span class="fig">${pct(agg.health_rate)}%</span><sup>2</sup>）；AI 對今日 <b>${agg.high_conf_den}</b> 筆判讀標記 <b>${agg.high_conf_num}</b> 筆高信心（<span class="fig a">${pct(agg.high_conf_ratio)}%</span><sup>3</sup>）——其餘刻意標低、交人工複核，<b>不讓 AI 用猜的硬寫進正式系統</b>。</p>
        <div class="notes"><b>[1]</b> 已簽核群組 ÷ 6（tickets.confirm_status）　<b>[2]</b> 綠燈群組 ÷ 6（近 24h 活動且未逾時）<br><b>[3]</b> high ÷ 當日已標信心度（tickets.confidence）——刻意不美化，誠實反映把握程度</div>
      </div>
      <div class="mp">
        ${meter("本日簽核完成率", agg.signoff_rate, `${agg.signed_groups} / 6 群組`, "b")}
        ${meter("六群組整體健康度", agg.health_rate, `${agg.green_groups} 綠 · ${yellow} 黃 · ${red} 紅`, "b2")}
        ${meter("今日 AI 高信心比例", agg.high_conf_ratio, `${agg.high_conf_num} / ${agg.high_conf_den} 筆`, "a")}
        <div class="ruler"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
      </div>
    </div>

    <div class="ops">
      <div class="op"><span class="ov">${agg.metrics.monthly_service_tickets}</span><span class="ol">本月維修工單</span><span class="os">CRM_service_tickets</span></div>
      <div class="op"><span class="ov">${agg.metrics.km_documents}</span><span class="ol">知識庫累積</span><span class="os">RAG 索引</span></div>
      <div class="op"><span class="ov" style="color:var(--amber)">${agg.metrics.pending_review}</span><span class="ol">待人工確認</span><span class="os">pending_review</span></div>
    </div>

    <div class="sh"><span class="no">§02</span><h2>六大 LINE 群組名冊</h2><span class="nt">系統輸入端 · 各群組對應一張 Ragic 表</span></div>
    <div class="hr"></div>
    ${reg}

    <div class="sh"><span class="no">§03</span><h2>每日簽核</h2><span class="nt">Human-in-the-loop · 簽核後才寫入 Ragic · 逾 24h 轉逾時警示</span></div>
    <table class="so"><thead><tr><th>群組</th><th>AI 今日草稿摘要</th><th>信心</th><th>狀態</th><th>簽核</th></tr></thead><tbody>${soRows}</tbody></table>

    <div class="sh"><span class="no">附錄</span><h2>多模態證據與檢索</h2><span class="nt">文字 · 照片 · 影片 · 文件 · 皆標來源群組</span></div>
    <div class="apx">
      <div class="col"><div class="ch">${icon("search")}智慧檢索 · 對話</div>${chat}</div>
      <div class="col"><div class="ch">${icon("csv")}多模態素材看板</div>${assets}</div>
      <div class="col"><div class="ch">${icon("image")}全台服務涵蓋</div>
        <div class="m9"><svg viewBox="0 0 120 150" preserveAspectRatio="xMidYMid meet"><path d="M62 8 C74 16 82 30 84 48 C86 66 82 88 74 112 C68 130 60 144 52 150 C46 144 40 130 38 112 C34 90 34 66 40 48 C46 28 52 14 62 8 Z" fill="none" stroke="var(--blue)" stroke-width="1.2" opacity=".6"/></svg>${pins}</div>
        <div class="mleg"><b>${gs2?.points ?? 0}</b> 服務據點 · <b>${gs2?.cities ?? 0}</b> 縣市 · <span style="color:var(--amber)">＋ ${esc(gs2?.hq ?? "")}</span></div>
      </div>
    </div>

    <div class="ft"><span>台灣福祉科技 × Ragic × 工研院多模態 RAG · 全地端服務 · 示範資料・已假名化</span><span style="margin-left:auto">資料源 tickets / CRM_service_tickets / pending_review · 角色 tenant_admin</span></div>
  </div>
</div>`;

  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><title>台灣福祉 AI 戰情室 — 治理總覽 v9 Blueprint</title><style>${css}</style></head><body>${body}</body></html>`;
}

// ───────── tenant_admin v10（Blueprint 向上精修：IBM Plex、雙尺度格線、刻度尺、互動狀態、語意 HTML）─────────
export function renderTenantAdminV10(data: WarRoomData, agg: Aggregate): string {
  const yellow = agg.groups.filter((x) => x.health === "yellow").length;
  const red = agg.groups.filter((x) => x.health === "red").length;
  const HC: Record<string, string> = { green: "var(--ok)", yellow: "var(--warn)", red: "var(--danger)", idle: "var(--ink-3)" };
  const meter = (label: string, ratio: number, sub: string, cls: string): string => {
    const p = pct(ratio);
    return `<div class="mrow"><div class="mtop"><span class="mlab">${label}</span><span class="mval">${p}<i>%</i></span></div>
      <div class="mbar"><span class="mfill ${cls}" style="width:${p}%"></span></div><div class="msub">${sub}</div></div>`;
  };
  const reg = agg.groups.map((gs, i) => {
    const d = gs.department; const isRag = d.ragic_table.includes("工研院");
    const st = gs.health === "red" ? "逾時警示・連續無新活動" : gs.signed_off ? `已簽核${isRag ? "・已同步工研院 RAG" : ""}`
      : gs.has_low_pending ? "低信心待補，需人工補資訊" : `正常處理中・今日 ${gs.today_total} 則`;
    return `<div class="rr${gs.health === "red" ? " alert" : ""}"><span class="ri">${String(i + 1).padStart(2, "0")}</span>
      <span class="rdot" style="background:${HC[gs.health]}"></span><span class="rn">${esc(d.name)}</span>
      <span class="rt">${isRag ? "→ 工研院多模態RAG" : esc(d.ragic_table)}</span>
      <span class="rs">${esc(st)}</span><span class="rtm">${esc(fmtActivity(d.last_activity, agg.as_of))}</span></div>`;
  }).join("");
  const confTag = (c: Ticket["confidence"]): string => {
    const m: Record<string, [string, string]> = { high: ["HIGH", "var(--ok)"], medium: ["MED", "var(--warn)"], low: ["LOW", "var(--danger)"] };
    if (!c) return `<span class="ct" style="color:var(--ink-3)">—</span>`;
    const [t, col] = m[c]; return `<span class="ct" style="color:${col}">▍${t}</span>`;
  };
  const soRows = agg.groups.map((gs) => {
    const d = gs.department; const ts = data.tickets.filter((t) => t.department_id === d.department_id);
    const low = ts.find((t) => t.needs_review);
    let draft: string, status: string, action: string;
    if (gs.health === "red" || ts.length === 0) {
      draft = `<span style="color:var(--ink-3)">連續 3 天無新訊息，無待簽核草稿——系統自動轉逾時警示</span>`;
      status = `<span class="pl danger">逾時警示</span>`; action = `<button class="ab">前往處理</button>`;
    } else {
      const extra = ts.length > 1 ? `<span class="rsub">＋${ts.length - 1} 筆</span>` : "";
      const isub = low ? `<div class="isub">⚠ 另 1 筆「門壞了」車號部位無法對應，已即時攔截，須人工補資訊</div>` : "";
      draft = `<b>${esc(ts[0].summary)}</b>${extra}${isub}`;
      if (gs.signed_off) { status = `<span class="pl ok">已簽核</span>`; action = `<span class="done">✓ ${esc(ts[0].confirmed_by ?? "")} ${esc(fmtActivity(ts[0].confirmed_at ?? agg.as_of, agg.as_of))}</span>`; }
      else if (low) { status = `<span class="pl danger">1 筆低信心</span>`; action = `<button class="ab">展開複核</button>`; }
      else { status = `<span class="pl warn">待簽核</span>`; action = `<button class="ab pri">確認今日進度</button>`; }
    }
    return `<tr><td class="g2">${esc(d.name)}</td><td class="dc">${draft}</td><td>${confTag(worstConf(ts))}</td><td>${status}</td><td class="ac">${action}</td></tr>`;
  }).join("");
  const ill = data.illustrative;
  const chat = (ill?.chat ?? []).map((c) => c.role === "you"
    ? `<div class="q9">&gt;&nbsp;${esc(c.text)}</div>`
    : `<div class="a9">${esc(c.text)}${c.cite ? `<span class="ci">└ ${esc(c.cite)}</span>` : ""}</div>`).join("");
  const KIND: Record<string, string> = { img: "image", vid: "video", pdf: "pdf", csv: "csv" };
  const KL: Record<string, string> = { img: "IMG", vid: "VID", pdf: "PDF", csv: "CSV" };
  const assets = (ill?.assets ?? []).map((a) =>
    `<div class="ar"><span class="ai">${icon(KIND[a.kind], 15)}</span><span class="an">${esc(a.name)}</span><span class="ak">${KL[a.kind]}·${esc(a.group)}</span></div>`).join("");
  const pins = (ill?.geo ?? []).map((p) => `<span class="pn${p.big ? " big" : ""}" style="left:${p.x}%;top:${p.y}%"></span>`).join("");
  const gs2 = ill?.geo_stats; const D = agg.as_of.slice(0, 10), T = agg.as_of.slice(11, 16);

  const css = `
  :root{--paper:#EDF0F3;--sheet:#F8FAFB;--well:#E8ECF0;--ink:#18242F;--ink-2:#4E5C67;--ink-3:#85929D;
    --line:#CFD7DF;--line-2:#E2E8ED;--gmaj:rgba(45,91,142,.10);--gmin:rgba(45,91,142,.05);
    --blue:#2C588A;--blue-2:#3D71AC;--blue-tint:#E3EBF4;--amber:#B0741A;
    --ok:#2C7A6B;--warn:#B0741A;--danger:#BE4630;
    --gr:"IBM Plex Sans","Helvetica Neue",-apple-system,"PingFang TC","Noto Sans TC",sans-serif;
    --mono:"IBM Plex Mono","SF Mono",ui-monospace,Menlo,monospace;--ease:cubic-bezier(.32,.72,0,1);}
  *{margin:0;padding:0;box-sizing:border-box}html,body{width:1600px}
  body{font-family:var(--gr);color:var(--ink);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;background:var(--paper);
    background-image:linear-gradient(var(--gmaj) 1px,transparent 1px),linear-gradient(90deg,var(--gmaj) 1px,transparent 1px),
      linear-gradient(var(--gmin) 1px,transparent 1px),linear-gradient(90deg,var(--gmin) 1px,transparent 1px);
    background-size:84px 84px,84px 84px,28px 28px,28px 28px;background-position:-1px -1px}
  body::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:9;opacity:.028;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E")}
  .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
  .lab{font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--blue);text-transform:uppercase;font-weight:500}
  a{transition:color .2s var(--ease)}:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
  @media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
  /* masthead */
  header.mh{display:flex;align-items:center;gap:16px;padding:0 32px;height:52px;background:var(--sheet);border-bottom:2px solid var(--blue);position:relative;z-index:10}
  .mh .mk{width:24px;height:24px;border:2px solid var(--blue);color:var(--blue);font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center}
  .mh b{font-size:14px;font-weight:600;letter-spacing:.01em}.mh .sub{font-size:10px;color:var(--ink-3);font-family:var(--mono);letter-spacing:.06em}
  .mh nav{display:flex;gap:2px;margin-left:14px;height:100%}
  .mh nav a{display:flex;align-items:center;padding:0 13px;font-size:12.5px;color:var(--ink-3);text-decoration:none;position:relative}
  .mh nav a:hover{color:var(--ink-2)}.mh nav a.on{color:var(--blue);font-weight:600}
  .mh nav a.on::after{content:"";position:absolute;left:13px;right:13px;bottom:0;height:2px;background:var(--blue)}
  .mh .rt{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--ink-2);text-align:right;line-height:1.5}.mh .rt b{color:var(--ink);font-weight:600}
  /* sheet */
  main.wrap{padding:22px 32px 30px;position:relative;z-index:1}
  .sheet{position:relative;background:var(--sheet);border:1px solid var(--line);box-shadow:0 1px 2px rgba(24,36,47,.05),0 18px 40px -30px rgba(24,36,47,.35),0 0 0 6px rgba(255,255,255,.4)}
  .rc{position:absolute;width:12px;height:12px;border:1.5px solid var(--blue);opacity:.6;z-index:2}
  .rc.tl{top:-1px;left:-1px;border-right:0;border-bottom:0}.rc.tr{top:-1px;right:-1px;border-left:0;border-bottom:0}
  .rc.bl{bottom:-1px;left:-1px;border-right:0;border-top:0}.rc.br{bottom:-1px;right:-1px;border-left:0;border-top:0}
  /* title block */
  .tb{display:flex;align-items:stretch;border-bottom:1px solid var(--blue)}
  .tb .ttl{padding:19px 26px 16px;flex:1}.tb .lab{margin-bottom:9px}
  .tb h1{font-size:31px;font-weight:600;letter-spacing:-.015em;line-height:.98;text-wrap:balance}
  .tb .dwg{margin-top:11px;font-family:var(--mono);font-size:10px;color:var(--ink-3);letter-spacing:.06em}
  .tb .meta{border-left:1px solid var(--line);display:grid;grid-template-columns:auto auto;font-family:var(--mono);font-size:10.5px}
  .tb .meta div{padding:8px 15px;border-bottom:1px solid var(--line-2)}
  .tb .meta .k{color:var(--ink-3);border-right:1px solid var(--line-2)}.tb .meta .v{color:var(--ink);text-align:right;font-weight:500}
  .tb .meta div:nth-last-child(-n+2){border-bottom:0}
  /* section head */
  section{display:block}
  .sh{display:flex;align-items:baseline;gap:11px;padding:15px 26px 3px}
  .sh .no{font-family:var(--mono);font-size:11px;color:var(--blue);font-weight:600}
  .sh h2{font-size:15px;font-weight:600;letter-spacing:0}.sh .nt{margin-left:auto;font-size:11px;color:var(--ink-3);font-family:var(--mono)}
  .hr{height:1px;background:var(--line);margin:8px 26px 0}
  /* lead */
  .lead{display:grid;grid-template-columns:1.72fr 1fr;border-bottom:1px solid var(--line)}
  .lead .pr{padding:17px 28px 16px;border-right:1px solid var(--line)}
  .lead .pr p{font-size:15.5px;line-height:2;color:var(--ink);max-width:56ch;text-wrap:pretty}.lead .pr p b{font-weight:600}
  .fig{font-family:var(--mono);font-size:20px;font-weight:600;color:var(--blue);letter-spacing:-.02em}.fig.a{color:var(--amber)}
  .lead .pr sup{font-family:var(--mono);font-size:9px;color:var(--amber);vertical-align:super}
  .notes{margin-top:15px;padding-top:12px;border-top:1px dashed var(--line);font-family:var(--mono);font-size:10px;color:var(--ink-3);line-height:2.05}.notes b{color:var(--blue)}
  /* meters */
  .mp{padding:16px 26px 13px}.mrow{padding:8px 0}
  .mtop{display:flex;align-items:baseline}.mlab{font-size:12px;color:var(--ink-2)}
  .mval{margin-left:auto;font-family:var(--mono);font-size:23px;font-weight:600;color:var(--ink);letter-spacing:-.02em}.mval i{font-size:12px;color:var(--ink-3);font-style:normal;margin-left:1px}
  .mbar{position:relative;height:10px;margin:7px 0 4px;background:var(--paper);box-shadow:inset 0 0 0 1px var(--line);
    background-image:repeating-linear-gradient(90deg,transparent 0 calc(25% - 1px),var(--line) calc(25% - 1px) 25%)}
  .mfill{position:absolute;top:0;left:0;height:100%;display:block;transition:width .6s var(--ease)}
  .mfill.b{background:var(--blue)}.mfill.b2{background:var(--blue-2)}.mfill.a{background:var(--amber)}
  .msub{font-family:var(--mono);font-size:9.5px;color:var(--ink-3)}
  .ruler{position:relative;height:16px;margin-top:5px;border-top:1px solid var(--line-2)}
  .ruler .tk{position:absolute;top:0;width:1px;height:4px;background:var(--ink-3)}
  .ruler .tl2{position:absolute;top:6px;font-family:var(--mono);font-size:8.5px;color:var(--ink-3);transform:translateX(-50%)}
  /* ops */
  .ops{display:flex;border-bottom:1px solid var(--line);background:var(--well)}
  .ops .op{padding:12px 26px;display:flex;align-items:baseline;gap:8px}.ops .op+.op{border-left:1px solid var(--line)}
  .ops .ov{font-family:var(--mono);font-size:19px;font-weight:600;letter-spacing:-.02em}.ops .ol{font-size:11.5px;color:var(--ink-2)}.ops .os{font-family:var(--mono);font-size:9px;color:var(--ink-3);margin-left:auto;padding-left:14px}
  /* register */
  .rr{display:flex;align-items:center;gap:14px;padding:11px 26px;border-bottom:1px solid var(--line-2);transition:background .15s var(--ease)}
  .rr:last-child{border-bottom:0}.rr:hover{background:var(--blue-tint)}
  .rr .ri{font-family:var(--mono);font-size:11px;color:var(--ink-3);width:18px}.rr .rdot{width:8px;height:8px;flex:none}
  .rr .rn{font-weight:600;font-size:14px;width:92px}.rr .rt{font-family:var(--mono);font-size:11px;color:var(--blue);background:var(--blue-tint);padding:2px 7px}
  .rr .rs{margin-left:auto;font-size:12px;color:var(--ink-2)}.rr .rtm{font-family:var(--mono);font-size:11px;color:var(--ink-3);width:64px;text-align:right}
  .rr.alert{background:#F8E9E4}.rr.alert:hover{background:#F5E2DC}.rr.alert .rs{color:var(--danger);font-weight:600}
  /* sign-off */
  table.so{width:100%;border-collapse:collapse;font-size:12.5px}
  .so th{text-align:left;font-family:var(--mono);font-size:10px;font-weight:500;color:var(--ink-3);letter-spacing:.1em;padding:9px 14px;border-bottom:1.5px solid var(--ink-2)}
  .so td{padding:12px 14px;border-bottom:1px solid var(--line-2);vertical-align:top}.so tr:last-child td{border-bottom:0}
  .so tr{transition:background .15s var(--ease)}.so tbody tr:hover{background:var(--well)}
  .so th:first-child,.so td:first-child{padding-left:26px}.so th:last-child,.so td:last-child{padding-right:26px;white-space:nowrap}
  .so td.g2{font-weight:600;white-space:nowrap}.so td.dc{color:var(--ink-2)}.so td.dc b{color:var(--ink);font-weight:600}
  .so .rsub{font-family:var(--mono);color:var(--ink-3);font-size:10.5px;margin-left:6px}.so .isub{color:var(--danger);font-size:11px;margin-top:4px;font-weight:600}
  .so td.ac .done{font-family:var(--mono);font-size:11.5px;color:var(--ok)}
  .ct{font-family:var(--mono);font-size:11px;font-weight:600}
  .pl{font-family:var(--mono);font-size:10px;font-weight:600;padding:1px 7px;border:1px solid currentColor;letter-spacing:.02em}
  .pl.ok{color:var(--ok)}.pl.warn{color:var(--warn)}.pl.danger{color:var(--danger)}
  .ab{font-family:var(--gr);font-size:12px;color:var(--blue);font-weight:600;background:none;border:1px solid var(--line);padding:5px 12px;cursor:pointer;transition:all .18s var(--ease)}
  .ab:hover{border-color:var(--blue);background:var(--blue-tint)}.ab:active{transform:translateY(1px)}
  .ab.pri{background:var(--blue);color:#fff;border-color:var(--blue)}.ab.pri:hover{background:var(--blue-2)}
  /* appendix */
  .apx{display:grid;grid-template-columns:1.3fr 1fr 1fr;border-top:1px solid var(--line)}
  .apx .col{padding:15px 22px 17px}.apx .col+.col{border-left:1px solid var(--line)}
  .apx .ch{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-bottom:12px}.apx .ch svg{color:var(--blue)}
  .q9{font-family:var(--mono);font-size:11px;color:var(--blue);text-align:right;margin-bottom:6px}
  .a9{font-size:12px;line-height:1.6;color:var(--ink);margin-bottom:10px}.a9 .ci{display:block;margin-top:3px;font-family:var(--mono);font-size:10px;color:var(--ink-3)}
  .ar{display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid var(--line-2);transition:background .15s}.ar:last-child{border-bottom:0}.ar:hover{background:var(--well)}
  .ar .ai{color:var(--blue);flex:none}.ar .an{font-size:12px;font-weight:500}.ar .ak{margin-left:auto;font-family:var(--mono);font-size:9.5px;color:var(--ink-3)}
  .m9{position:relative;height:152px;background:var(--paper);border:1px solid var(--line);
    background-image:linear-gradient(var(--line-2) 1px,transparent 1px),linear-gradient(90deg,var(--line-2) 1px,transparent 1px);background-size:16px 16px}
  .m9 svg{position:absolute;inset:0;width:100%;height:100%}
  .pn{position:absolute;width:7px;height:7px;transform:translate(-50%,-50%);border:1.5px solid var(--amber)}
  .pn::before,.pn::after{content:"";position:absolute;background:var(--amber)}.pn::before{left:50%;top:-3px;width:1px;height:13px;transform:translateX(-50%)}.pn::after{top:50%;left:-3px;height:1px;width:13px;transform:translateY(-50%)}
  .pn.big{width:10px;height:10px}
  .mleg{margin-top:9px;font-family:var(--mono);font-size:10px;color:var(--ink-2)}.mleg b{color:var(--ink)}
  footer.ft{display:flex;padding:12px 26px;border-top:1px solid var(--line);font-family:var(--mono);font-size:10px;color:var(--ink-3)}`;

  const body = `
<header class="mh">
  <div class="mk">福</div><div><b>台灣福祉科技</b> <span class="sub">AI 戰情室</span></div>
  <nav><a class="on" href="#" aria-current="page">戰情室</a><a href="#">每日簽核</a><a href="#">知識檢索</a><a href="#">Ragic 總台</a></nav>
  <div class="rt"><b>總經理室</b>　tenant_admin<br>${esc(D)} ${esc(T)}</div>
</header>
<main class="wrap">
  <article class="sheet">
    <span class="rc tl"></span><span class="rc tr"></span><span class="rc bl"></span><span class="rc br"></span>
    <div class="tb">
      <div class="ttl"><div class="lab">現場治理總覽 · 特種車輛改裝廠</div><h1>現場治理總覽</h1>
        <div class="dwg">SCALE 1:1　·　SHEET 01/01　·　REV v10　·　來源可回溯</div></div>
      <div class="meta">
        <div class="k">日期</div><div class="v">${esc(D)} ${esc(T)}</div>
        <div class="k">產線</div><div class="v">復康巴士/福祉車/沐浴車</div>
        <div class="k">檢視</div><div class="v">tenant_admin</div>
        <div class="k">狀態</div><div class="v" style="color:var(--ok)">● 整體正常</div>
      </div>
    </div>

    <section><div class="sh"><span class="no">§01</span><h2>治理摘要</h2><span class="nt">每個數字可回溯至來源表</span></div>
    <div class="hr"></div>
    <div class="lead">
      <div class="pr">
        <p>今日六大群組，<b>${agg.signed_groups}</b> 組已完成人工簽核（<span class="fig">${pct(agg.signoff_rate)}%</span><sup>1</sup>）、<b>${agg.green_groups}</b> 組亮綠燈（<span class="fig">${pct(agg.health_rate)}%</span><sup>2</sup>）；AI 對今日 <b>${agg.high_conf_den}</b> 筆判讀標記 <b>${agg.high_conf_num}</b> 筆高信心（<span class="fig a">${pct(agg.high_conf_ratio)}%</span><sup>3</sup>）——其餘刻意標低、交人工複核，<b>不讓 AI 用猜的硬寫進正式系統</b>。</p>
        <div class="notes"><b>[1]</b> 已簽核群組 ÷ 6（tickets.confirm_status）　<b>[2]</b> 綠燈群組 ÷ 6（近 24h 活動且未逾時）<br><b>[3]</b> high ÷ 當日已標信心度（tickets.confidence）——刻意不美化，誠實反映把握程度</div>
      </div>
      <div class="mp">
        ${meter("本日簽核完成率", agg.signoff_rate, `${agg.signed_groups} / 6 群組`, "b")}
        ${meter("六群組整體健康度", agg.health_rate, `${agg.green_groups} 綠 · ${yellow} 黃 · ${red} 紅`, "b2")}
        ${meter("今日 AI 高信心比例", agg.high_conf_ratio, `${agg.high_conf_num} / ${agg.high_conf_den} 筆`, "a")}
        <div class="ruler">${[0, 25, 50, 75, 100].map((n) => `<span class="tk" style="left:${n}%"></span><span class="tl2" style="left:${n}%">${n}</span>`).join("")}</div>
      </div>
    </div></section>

    <div class="ops">
      <div class="op"><span class="ov">${agg.metrics.monthly_service_tickets}</span><span class="ol">本月維修工單</span><span class="os">CRM_service_tickets</span></div>
      <div class="op"><span class="ov">${agg.metrics.km_documents}</span><span class="ol">知識庫累積</span><span class="os">RAG 索引</span></div>
      <div class="op"><span class="ov" style="color:var(--amber)">${agg.metrics.pending_review}</span><span class="ol">待人工確認</span><span class="os">pending_review</span></div>
    </div>

    <section><div class="sh"><span class="no">§02</span><h2>六大 LINE 群組名冊</h2><span class="nt">系統輸入端 · 各群組對應一張 Ragic 表</span></div>
    <div class="hr"></div>${reg}</section>

    <section><div class="sh"><span class="no">§03</span><h2>每日簽核</h2><span class="nt">Human-in-the-loop · 簽核後才寫入 Ragic · 逾 24h 轉逾時警示</span></div>
    <table class="so"><thead><tr><th>群組</th><th>AI 今日草稿摘要</th><th>信心</th><th>狀態</th><th>簽核</th></tr></thead><tbody>${soRows}</tbody></table></section>

    <section><div class="sh"><span class="no">附錄</span><h2>多模態證據與檢索</h2><span class="nt">文字 · 照片 · 影片 · 文件 · 皆標來源群組</span></div>
    <div class="apx">
      <div class="col"><div class="ch">${icon("search")}智慧檢索 · 對話</div>${chat}</div>
      <div class="col"><div class="ch">${icon("csv")}多模態素材看板</div>${assets}</div>
      <aside class="col"><div class="ch">${icon("image")}全台服務涵蓋</div>
        <div class="m9"><svg viewBox="0 0 120 150" preserveAspectRatio="xMidYMid meet" aria-label="全台服務據點分布"><path d="M62 8 C74 16 82 30 84 48 C86 66 82 88 74 112 C68 130 60 144 52 150 C46 144 40 130 38 112 C34 90 34 66 40 48 C46 28 52 14 62 8 Z" fill="none" stroke="var(--blue)" stroke-width="1.2" opacity=".55"/></svg>${pins}</div>
        <div class="mleg"><b>${gs2?.points ?? 0}</b> 服務據點 · <b>${gs2?.cities ?? 0}</b> 縣市 · <span style="color:var(--amber)">＋ ${esc(gs2?.hq ?? "")}</span></div>
      </aside>
    </div></section>

    <footer class="ft"><span>台灣福祉科技 × Ragic × 工研院多模態 RAG · 全地端服務 · 示範資料・已假名化</span><span style="margin-left:auto">資料源 tickets / CRM_service_tickets / pending_review · 角色 tenant_admin</span></footer>
  </article>
</main>`;
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>台灣福祉 AI 戰情室 — 治理總覽 v10 Blueprint</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style></head><body>${body}</body></html>`;
}
