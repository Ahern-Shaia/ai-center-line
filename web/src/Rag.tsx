import { useEffect, useRef, useState } from "react";
import Drawer from "./Drawer";
import { RAG_QA, type Citation, type RagQA } from "./mockdata/ragQA";

interface Msg {
  role: "user" | "ai";
  qa?: RagQA;
  text?: string;
  displayed?: number;   // for typewriter
}

const KIND_LABEL: Record<Citation["kind"], string> = {
  ticket: "工單", km: "知識庫", message: "群組訊息", external: "工研院 RAG",
};

export default function Rag() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [source, setSource] = useState<Citation | null>(null);
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const bodyRef = useRef<HTMLDivElement>(null);

  // 有新訊息就捲到底
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
    // typewriter — 每 12ms 前進 1 字
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

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>智慧檢索</h1>
          <div className="sub">跨 LINE 群組 · 工單 · 知識庫 · 工研院 RAG 的多模態問答</div>
        </div>
      </div>

      <div className="banner">
        <span>本 demo 使用假名化案例，5 對預錄 Q&A 展示 <b>grounded citation</b>（AI 回答的每一句都可反查原始文件）</span>
      </div>

      <div className="rag-shell">
        <div className="rag-chat">
          <div className="rag-body" ref={bodyRef}>
            {msgs.length === 0 && (
              <div className="rag-empty">
                <div className="rag-empty-h">你可以問我這些問題 ↓</div>
                <div className="rag-empty-hint">點下面任一問題即可看 AI 回答，回答內會標註 [1] [2] 引用來源，點來源可反查原文</div>
              </div>
            )}
            {msgs.map((m, i) => (
              m.role === "user"
                ? <div key={i} className="rag-msg user"><div className="rag-avatar user">你</div><div className="rag-bubble">{m.text}</div></div>
                : <RagAnswer key={i} m={m} onCite={setSource} />
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
                <div className="rag-sug-done">所有預錄問題都問過了 · 正式版接 /rag/query</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Drawer
        open={!!source}
        onClose={() => setSource(null)}
        title={source ? `${KIND_LABEL[source.kind]} · ${source.ref}` : ""}
        subtitle={source ? source.title : ""}
        width={520}
      >
        {source && (
          <>
            <div className="src-meta">
              <div className="tc-kv">
                <span className="tc-k">來源</span>
                <span className="tc-v">{source.source}</span>
              </div>
              <div className="tc-kv">
                <span className="tc-k">類型</span>
                <span className="tc-v">{KIND_LABEL[source.kind]}</span>
              </div>
              <div className="tc-kv">
                <span className="tc-k">識別碼</span>
                <span className="tc-v mono">{source.ref}</span>
              </div>
            </div>
            <div className="src-body">
              <div className="tc-sec-lbl" style={{ marginBottom: 8 }}>內容片段</div>
              <div className="src-snippet">{source.snippet}</div>
            </div>
            <div className="src-note">
              正式版：這裡會載入原始文件全文（工單完整記錄 / KM 卡片 / 群組訊息上下文 30 則 / 外部 RAG 對應條目）。可 pin 多份並列比對。
            </div>
          </>
        )}
      </Drawer>
    </>
  );
}

function RagAnswer({ m, onCite }: { m: Msg; onCite: (c: Citation) => void }) {
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
            consumed += 3; // 每 citation 標記占 3 字
            if (displayed < from + 3) return null;
            const c = qa.citations.find((x) => x.id === p.citeId);
            if (!c) return null;
            return (
              <button key={i} className="rag-cite" onClick={() => onCite(c)} title={c.title}>
                [{c.id}]
              </button>
            );
          })}
        </div>

        {displayed >= answerCharCount(qa) && (
          <>
            <div className="rag-cites">
              {qa.citations.map((c) => (
                <button key={c.id} className="rag-cite-card" onClick={() => onCite(c)}>
                  <span className="rag-cite-num">[{c.id}]</span>
                  <span className="rag-cite-body">
                    <span className="rag-cite-title">{c.title}</span>
                    <span className="rag-cite-meta">{KIND_LABEL[c.kind]} · {c.ref} · {c.source}</span>
                  </span>
                </button>
              ))}
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
