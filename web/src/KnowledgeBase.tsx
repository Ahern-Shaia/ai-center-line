import { useMemo, useState } from "react";
import { KM_CARDS, type KnowledgeCard } from "./mockdata/knowledgeCards";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

export default function KnowledgeBase() {
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
      <div className="pane-hdr">
        <div>
          <h1>知識庫</h1>
          <div className="sub">AI 從 LINE 對話中抽取的可重用知識卡 · 共 {KM_CARDS.length} 張 · 已同步 RAG 索引 {KM_CARDS.filter((c) => c.indexedRag).length} 張</div>
        </div>
      </div>

      <div className="kb-toolbar">
        <input
          className="kb-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋標題、內文或標籤，例如：升降機 / 消防"
          aria-label="搜尋知識卡"
        />
        <div className="kb-dept-filters">
          <button className={`kb-dept${dept === "all" ? " active" : ""}`} onClick={() => setDept("all")}>全部</button>
          {depts.map((d) => (
            <button key={d} className={`kb-dept${dept === d ? " active" : ""}`} onClick={() => setDept(d)}>{d}</button>
          ))}
        </div>
      </div>

      {list.length === 0 && (
        <div className="state">
          <h3>找不到符合的知識卡</h3>
          <p>試試調整關鍵字或切換部門</p>
        </div>
      )}

      <div className="kb-grid">
        {list.map((c) => <KmCard key={c.id} c={c} />)}
      </div>
    </>
  );
}

function KmCard({ c }: { c: KnowledgeCard }) {
  return (
    <article className="kb-card">
      <header className="kb-card-hdr">
        <span className="kb-card-id mono">{c.id}</span>
        {c.indexedRag && <span className="kb-card-badge">已入庫</span>}
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
        <span>來源 {c.sourceCount} 則訊息</span>
      </footer>
    </article>
  );
}
