import Drawer from "../shared/Drawer";
import { findExcerpt, type LineMessage } from "../mockdata/lineExcerpts";

interface Props {
  open: boolean;
  onClose: () => void;
  summary: string | null;   // 傳 ticket summary，內部查 excerpt
  confidence: "high" | "medium" | "low" | null;
  needsReview: boolean;
}

const KIND_LABEL: Record<string, string> = { photo: "📷 照片", video: "🎬 影片", sticker: "😀 貼圖", audio: "🎙 語音" };

export default function SourceDrawer({ open, onClose, summary, confidence, needsReview }: Props) {
  const ex = summary ? findExcerpt(summary) : undefined;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={ex ? `${ex.ticketId} · 來源與抽取` : "來源與抽取"}
      subtitle={summary ?? ""}
      width={580}
    >
      {!ex && summary && (
        <div className="tc-empty">尚無來源資料</div>
      )}
      {ex && (
        <>
          <div className="tc-hdr" style={{ marginTop: 0 }}>
            <span className={`tag ${confidence === "high" ? "ok" : confidence === "medium" ? "warn" : "danger"}`}>
              {confidence === "high" ? "高信心" : confidence === "medium" ? "中信心" : "低信心"}
            </span>
            {needsReview && <span className="tag danger">已即時攔截 · 需補資訊</span>}
          </div>

          <div className="tc-sec">
            <span className="tc-sec-lbl">原始 LINE 對話</span>
            <div className="tc-raw">
              {ex.raw.map((m, i) => <LineBubble key={i} m={m} />)}
            </div>
          </div>

          <div className="tc-sec">
            <span className="tc-sec-lbl">AI 抽取結果</span>
            <div className="tc-extract">
              {ex.extracted.map((e, i) => (
                <div key={i} className="tc-kv">
                  <span className="tc-k">{e.field}</span>
                  <span className="tc-v">{e.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="tc-sec">
            <span className="tc-sec-lbl">信心度理由</span>
            <div className="tc-reason">{ex.confidenceReason}</div>
          </div>

          <div className="tc-sec">
            <span className="tc-sec-lbl">簽核後同步至</span>
            <div className="tc-ragic">→ {ex.ragicTarget}</div>
          </div>
        </>
      )}
    </Drawer>
  );
}

function LineBubble({ m }: { m: LineMessage }) {
  return (
    <div className="lb">
      <div className="lb-meta">
        <span className="lb-time mono">{m.time}</span>
        <span className="lb-sender">{m.sender}</span>
        {m.kind && m.kind !== "text" && <span className="lb-kind">{KIND_LABEL[m.kind] ?? m.kind}</span>}
      </div>
      <div className="lb-text">{m.text}</div>
    </div>
  );
}
