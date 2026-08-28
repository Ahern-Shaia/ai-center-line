import { useMemo, useState } from "react";
import { useT } from "../i18n/useT";
import DemoDataBanner from "../shared/DemoDataBanner";
import { KM_CARDS, type KnowledgeCard } from "../mockdata/knowledgeCards";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

export default function KnowledgeBase() {
  const tr = useT();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState<string | "all">("all");

  const list = useMemo(() => {
    const query = q.trim();
    return KM_CARDS.filter((c) => {
      if (dept !== "all" && c.dept !== dept) return false;
      if (!query) return true;
      const target = `${c.title} ${c.body} ${c.tags.join(" ")}`;
      return target.includes(query);
    });
  }, [q, dept]);

  const depts = useMemo(() => Array.from(new Set(KM_CARDS.map((c) => c.dept))), []);

  return (
    <>
      <DemoDataBanner doc={tr("km.demoDoc")} />
      <div className="pane-hdr">
        <div>
          <h1>{tr("nav.km")}</h1>
          <div className="sub">{tr("km.sub", { total: KM_CARDS.length, indexed: KM_CARDS.filter((c) => c.indexedRag).length })}</div>
        </div>
      </div>

      <div className="kb-toolbar">
        <input
          className="kb-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr("km.searchPh")}
          aria-label={tr("km.searchAria")}
        />
        <div className="kb-dept-filters">
          <button className={`kb-dept${dept === "all" ? " active" : ""}`} onClick={() => setDept("all")}>{tr("km.all")}</button>
          {depts.map((d) => (
            <button key={d} className={`kb-dept${dept === d ? " active" : ""}`} onClick={() => setDept(d)}>{d}</button>
          ))}
        </div>
      </div>

      {list.length === 0 && (
        <div className="state">
          <h3>{tr("km.noneTitle")}</h3>
          <p>{tr("km.noneHint")}</p>
        </div>
      )}

      <div className="kb-grid">
        {list.map((c) => <KmCard key={c.id} c={c} />)}
      </div>
    </>
  );
}

function KmCard({ c }: { c: KnowledgeCard }) {
  const tr = useT();
  return (
    <article className="kb-card">
      <header className="kb-card-hdr">
        <span className="kb-card-id mono">{c.id}</span>
        {c.indexedRag && <span className="kb-card-badge">{tr("km.indexed")}</span>}
      </header>
      <h3 className="kb-card-title">{c.title}</h3>
      <p className="kb-card-body">{c.body}</p>
      <div className="kb-card-tags">
        {c.tags.map((t) => <span key={t} className="kb-tag">{t}</span>)}
      </div>
      <footer className="kb-card-foot">
        <span>{c.dept}</span>
        <span className="kb-card-dot">·</span>
        <span className="mono">{fmtDate(c.updatedAt)}</span>
        <span className="kb-card-dot">·</span>
        <span>{tr("km.sourceCount", { n: c.sourceCount })}</span>
      </footer>
    </article>
  );
}
