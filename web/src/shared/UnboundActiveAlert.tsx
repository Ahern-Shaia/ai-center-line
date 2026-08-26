import { useState } from "react";
import type { UnboundStats } from "../api";
import { useT } from "../i18n/useT";

// 未綁定活躍者 · 折疊清單 · aiproot 版與租戶版共用
// 預設折疊（只顯人數）· 展開後列出全部（後端上限 100）
export default function UnboundActiveAlert({
  unboundCount,
  top,
}: {
  unboundCount: number;
  top: UnboundStats["top"];
}) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  if (unboundCount <= 0) return null;

  return (
    <div className="dm-empty" style={{ background: "var(--warn-tint)", border: "1px solid #F5D5A6", textAlign: "left", padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <b style={{ color: "#7A4E1B" }}>⚠ {tr("ub.title", { n: unboundCount })}</b>
        {top.length > 0 && (
          <button className="btn small" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? tr("common.collapse") : tr("ub.expand", { n: top.length })}
          </button>
        )}
      </div>
      <div style={{ marginTop: 6, fontSize: 12 }}>
        {tr("ub.hint")}
      </div>

      {open && (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {top.map((u) => (
            <li key={u.senderLineId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 10px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 12.5 }}>
              <b style={{ fontWeight: 600 }}>{u.displayName ?? u.senderLineId.slice(-6)}</b>
              <span style={{ color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                {tr("mb.nMsgs", { n: u.messageCount })}{u.topGroupName ? ` · ${u.topGroupName}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && unboundCount > top.length && (
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>
          {tr("ub.foot", { total: unboundCount, shown: top.length })}
        </div>
      )}
    </div>
  );
}
