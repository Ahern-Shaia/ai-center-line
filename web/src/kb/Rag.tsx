import { useEffect, useMemo, useRef, useState } from "react";
import DemoDataBanner from "../shared/DemoDataBanner";
import { RAG_QA, type Citation, type RagQA } from "../mockdata/ragQA";
import { useToast } from "../Toast";

interface Msg {
  role: "user" | "ai";
  qa?: RagQA;
  text?: string;
  displayed?: number;
}

const KIND_LABEL: Record<Citation["kind"], string> = {
  ticket: "工單", km: "知識庫", message: "群組訊息", external: "工研院資料庫",
  image: "圖檔", spreadsheet: "試算表",
};

const KIND_ICON: Record<Citation["kind"], string> = {
  ticket: "▤", km: "▦", message: "▧", external: "◈", image: "▩", spreadsheet: "◫",
};

function extractKeywords(question: string): string[] {
  return question.split(/[，。？！\s·、,.\?!]+/).filter((w) => w.length >= 2);
}

function matchQA(input: string): RagQA | null {
  const q = input.trim();
  if (!q) return null;
  const exact = RAG_QA.find((qa) => qa.question === q);
  if (exact) return exact;
  return RAG_QA.find((qa) => {
    const kws = extractKeywords(qa.question);
    return kws.some((k) => q.includes(k));
  }) ?? null;
}

export default function Rag() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [source, setSource] = useState<Citation | null>(null);
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const answerCharCount = (qa: RagQA) =>
    qa.answerParts.reduce<number>((n, p) => n + (typeof p === "string" ? p.length : 3), 0);

  async function ask(qa: RagQA) {
    if (typing) return;
    if (asked.has(qa.question)) return;
    setAsked((s) => new Set(s).add(qa.question));
    setMsgs((m) => [...m, { role: "user", text: qa.question }]);
    setTyping(true);
    const total = answerCharCount(qa);
    const aiIdx = msgs.length + 1;
    setMsgs((m) => [...m, { role: "ai", qa, displayed: 0 }]);
    for (let i = 0; i <= total; i += 3) {
      await new Promise((r) => setTimeout(r, 12));
      setMsgs((m) => m.map((x, k) => k === aiIdx ? { ...x, displayed: Math.min(i, total) } : x));
    }
    setMsgs((m) => m.map((x, k) => k === aiIdx ? { ...x, displayed: total } : x));
    setTyping(false);
  }

  const suggestions = RAG_QA.filter((q) => !asked.has(q.question));

  // 收集本次對話的所有引用來源（給右側「全部來源」清單用）
  const allCitations = useMemo(() => {
    const seen = new Set<string>();
    const list: Citation[] = [];
    for (const m of msgs) {
      if (m.qa) {
        for (const c of m.qa.citations) {
          const key = `${c.kind}:${c.ref}`;
          if (!seen.has(key)) { seen.add(key); list.push(c); }
        }
      }
    }
    return list;
  }, [msgs]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (typing) return;
    const q = input.trim();
    if (!q) return;
    const qa = matchQA(q);
    if (!qa) {
      toast.show("本次示範聚焦下列 5 個主題，請從建議問題選擇或改用相關關鍵字", "warn");
      return;
    }
    if (asked.has(qa.question)) {
      toast.show("此問題已回答過，請點下方其他建議問題", "warn");
      return;
    }
    setInput("");
    ask(qa);
  }

  return (
    <>
      <DemoDataBanner doc="docs/modules/rag-conversations.md（M0 待裁定）" />
      <div className="pane-hdr">
        <div>
          <h1>智慧檢索</h1>
          <div className="sub">跨 LINE 群組 · 工單 · 知識庫 · 工研院資料庫 的整合問答</div>
        </div>
      </div>

      <div className="rag-shell">
        <div className="rag-chat">
          <div className="rag-body" ref={bodyRef}>
            {msgs.length === 0 && (
              <div className="rag-empty">
                <div className="rag-empty-h">你可以問我這些問題 ↓</div>
                <div className="rag-empty-hint">點下面任一問題或直接輸入。AI 回答內會標註 [1] [2] 引用來源，點擊即可在右側查看原始檔案</div>
              </div>
            )}
            {msgs.map((m, i) => (
              m.role === "user"
                ? <div key={i} className="rag-msg user"><div className="rag-avatar user">你</div><div className="rag-bubble">{m.text}</div></div>
                : <RagAnswer key={i} m={m} onCite={setSource} activeId={source?.id ?? null} activeRef={source?.ref ?? null} />
            ))}
            {typing && (
              <div className="rag-msg">
                <div className="rag-avatar ai">AI</div>
                <div className="rag-typing"><span /><span /><span /></div>
              </div>
            )}
          </div>

          <div className="rag-suggestions">
            {suggestions.length > 0 && <div className="rag-sug-lbl">建議問題</div>}
            <div className="rag-sug-chips">
              {suggestions.map((qa) => (
                <button key={qa.question} className="rag-chip" disabled={typing} onClick={() => ask(qa)}>
                  <span className="rag-chip-cat">{qa.category}</span>
                  {qa.question}
                </button>
              ))}
              {suggestions.length === 0 && (
                <div className="rag-sug-done">目前可展示的問題已完成</div>
              )}
            </div>
          </div>

          <form className="rag-input-row" onSubmit={handleSubmit}>
            <input
              className="rag-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="輸入問題，例如：某福祉車升降機該如何保養？"
              disabled={typing}
              aria-label="輸入問題"
            />
            <button type="submit" className="rag-send" disabled={typing || !input.trim()}>送出</button>
          </form>
        </div>

        <aside className="rag-sources">
          <header className="rag-sources-hdr">
            <div className="rag-sources-title">資料來源</div>
            {source && (
              <button className="rag-sources-back" onClick={() => setSource(null)}>← 全部來源</button>
            )}
          </header>
          <div className="rag-sources-body">
            {source ? (
              <SourceView citation={source} />
            ) : (
              <SourceList citations={allCitations} onSelect={setSource} />
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

function SourceList({ citations, onSelect }: { citations: Citation[]; onSelect: (c: Citation) => void }) {
  if (citations.length === 0) {
    return (
      <div className="src-empty">
        <div className="src-empty-h">先問一個問題</div>
        <div className="src-empty-hint">AI 回答的每一個引用都會出現在這裡，可分類檢視原始檔案（工單／知識庫／群組訊息／圖檔／試算表／工研院資料庫）</div>
      </div>
    );
  }
  return (
    <div className="src-list">
      <div className="src-list-lbl">本次對話引用共 {citations.length} 筆</div>
      {citations.map((c) => (
        <button key={`${c.kind}:${c.ref}`} className="src-list-card" onClick={() => onSelect(c)}>
          <span className="src-list-icon" aria-hidden>{KIND_ICON[c.kind]}</span>
          <span className="src-list-body">
            <span className="src-list-kind">{KIND_LABEL[c.kind]}</span>
            <span className="src-list-title">{c.title}</span>
            <span className="src-list-ref mono">{c.ref}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function SourceView({ citation }: { citation: Citation }) {
  return (
    <div className="src-view">
      <div className="src-view-hdr">
        <span className="src-view-icon" aria-hidden>{KIND_ICON[citation.kind]}</span>
        <div className="src-view-hdr-text">
          <div className="src-view-kind">{KIND_LABEL[citation.kind]}</div>
          <div className="src-view-title">{citation.title}</div>
          <div className="src-view-ref mono">{citation.ref}</div>
        </div>
      </div>
      <div className="src-view-meta">
        <span className="src-view-meta-lbl">來源</span>
        <span>{citation.source}</span>
      </div>
      <div className="src-view-body">
        {citation.kind === "image" && citation.image && <ImageMock caption={citation.image.caption} ref_={citation.ref} />}
        {citation.kind === "spreadsheet" && citation.spreadsheet && (
          <SpreadsheetMock headers={citation.spreadsheet.headers} rows={citation.spreadsheet.rows} />
        )}
        {(citation.kind === "ticket" || citation.kind === "km" || citation.kind === "message" || citation.kind === "external") && (
          <div className="src-view-snippet">{citation.snippet}</div>
        )}
      </div>
    </div>
  );
}

function SpreadsheetMock({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="src-sheet">
      <div className="src-sheet-tabs">
        <span className="src-sheet-tab active">工作表 1</span>
        <span className="src-sheet-tab">彙整</span>
        <span className="src-sheet-tab">明細</span>
      </div>
      <div className="src-sheet-wrap">
        <table className="src-sheet-table">
          <thead>
            <tr>
              <th className="src-sheet-th src-sheet-th-num"></th>
              {headers.map((h, i) => <th key={i} className="src-sheet-th">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="src-sheet-td src-sheet-td-num">{i + 1}</td>
                {r.map((cell, j) => <td key={j} className="src-sheet-td">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="src-sheet-foot mono">共 {rows.length} 筆 · {headers.length} 欄</div>
    </div>
  );
}

function ImageMock({ caption, ref_ }: { caption: string; ref_: string }) {
  return (
    <div className="src-image">
      <div className="src-image-wrap">
        <svg viewBox="0 0 320 200" className="src-image-svg" role="img" aria-label={caption}>
          {/* 車體側視輪廓 */}
          <rect x="24" y="70" width="220" height="88" fill="none" stroke="currentColor" strokeWidth="1.5" />
          {/* 車頂 */}
          <line x1="40" y1="70" x2="230" y2="70" stroke="currentColor" strokeWidth="1.5" />
          {/* 前擋玻璃 */}
          <path d="M24 70 L24 92 L48 92 L60 70" fill="none" stroke="currentColor" strokeWidth="1.5" />
          {/* 側窗 */}
          <rect x="70" y="80" width="150" height="26" fill="none" stroke="currentColor" strokeWidth="1" />
          {/* 車輪 */}
          <circle cx="70" cy="160" r="14" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="70" cy="160" r="5" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="200" cy="160" r="14" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="200" cy="160" r="5" fill="none" stroke="currentColor" strokeWidth="1" />
          {/* 後尾門區域 */}
          <rect x="244" y="70" width="52" height="88" fill="none" stroke="currentColor" strokeWidth="1.5" />
          {/* 升降機平台（伸出）*/}
          <rect x="240" y="140" width="60" height="4" fill="currentColor" opacity=".7" />
          <line x1="240" y1="144" x2="300" y2="144" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2,2" />
          {/* 鋼索 x2 */}
          <line x1="252" y1="72" x2="252" y2="140" stroke="currentColor" strokeWidth="0.8" strokeDasharray="3,2" />
          <line x1="288" y1="72" x2="288" y2="140" stroke="currentColor" strokeWidth="0.8" strokeDasharray="3,2" />
          {/* 標註引線與文字 */}
          <line x1="270" y1="140" x2="270" y2="180" stroke="currentColor" strokeWidth="0.5" />
          <text x="270" y="192" fontSize="9" fill="currentColor" textAnchor="middle" fontFamily="var(--mono)">升降機平台</text>
          <line x1="252" y1="72" x2="240" y2="50" stroke="currentColor" strokeWidth="0.5" />
          <text x="238" y="46" fontSize="9" fill="currentColor" textAnchor="end" fontFamily="var(--mono)">鋼索 × 2</text>
          <line x1="120" y1="106" x2="120" y2="130" stroke="currentColor" strokeWidth="0.5" />
          <text x="120" y="140" fontSize="9" fill="currentColor" textAnchor="middle" fontFamily="var(--mono)">乘客艙</text>
          {/* 尺標 */}
          <line x1="24" y1="182" x2="296" y2="182" stroke="currentColor" strokeWidth="0.5" />
          <line x1="24" y1="180" x2="24" y2="184" stroke="currentColor" strokeWidth="0.5" />
          <line x1="296" y1="180" x2="296" y2="184" stroke="currentColor" strokeWidth="0.5" />
        </svg>
      </div>
      <div className="src-image-caption">{caption}</div>
      <div className="src-image-meta mono">檔案：{ref_} · 儲存位置：技術研發 檔案庫</div>
    </div>
  );
}

function RagAnswer({ m, onCite, activeId, activeRef }: {
  m: Msg;
  onCite: (c: Citation) => void;
  activeId: number | null;
  activeRef: string | null;
}) {
  if (!m.qa) return null;
  const qa = m.qa;
  const displayed = m.displayed ?? 0;
  let consumed = 0;

  return (
    <div className="rag-msg">
      <div className="rag-avatar ai">AI</div>
      <div className="rag-bubble">
        <div className="rag-answer">
          {qa.answerParts.map((p, i) => {
            if (typeof p === "string") {
              const from = consumed;
              consumed += p.length;
              const visible = Math.max(0, Math.min(p.length, displayed - from));
              return <span key={i}>{p.slice(0, visible)}</span>;
            }
            const from = consumed;
            consumed += 3;
            if (displayed < from + 3) return null;
            const c = qa.citations.find((x) => x.id === p.citeId);
            if (!c) return null;
            const active = activeId === c.id && activeRef === c.ref;
            return (
              <button
                key={i}
                className={`rag-cite${active ? " active" : ""}`}
                onClick={() => onCite(c)}
                title={c.title}
              >
                [{c.id}]
              </button>
            );
          })}
        </div>

        {displayed >= answerCharCount(qa) && (
          <>
            <div className="rag-cites">
              {qa.citations.map((c) => {
                const active = activeId === c.id && activeRef === c.ref;
                return (
                  <button
                    key={c.id}
                    className={`rag-cite-card${active ? " active" : ""}`}
                    onClick={() => onCite(c)}
                  >
                    <span className="rag-cite-num">[{c.id}]</span>
                    <span className="rag-cite-body">
                      <span className="rag-cite-title">{c.title}</span>
                      <span className="rag-cite-meta">{KIND_LABEL[c.kind]} · {c.ref} · {c.source}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {qa.followup && (
              <div className="rag-followup">
                <span className="rag-followup-lbl">追問</span>
                {qa.followup}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function answerCharCount(qa: RagQA) {
  return qa.answerParts.reduce<number>((n, p) => n + (typeof p === "string" ? p.length : 3), 0);
}
