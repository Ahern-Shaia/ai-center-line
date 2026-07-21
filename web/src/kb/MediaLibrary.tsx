import { useMemo, useState } from "react";
import { MEDIA_FILES, type MediaKind } from "../mockdata/mediaFiles";

const KIND_LABEL: Record<MediaKind, string> = { image: "圖片", video: "影片", document: "文件", spreadsheet: "試算表", audio: "語音" };
const KIND_ICON: Record<MediaKind, string> = { image: "▩", video: "▶", document: "▤", spreadsheet: "◫", audio: "◉" };
const KIND_FILTERS: (MediaKind | "all")[] = ["all", "image", "video", "document", "spreadsheet", "audio"];

function fmtSize(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate().toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export default function MediaLibrary() {
  const [filter, setFilter] = useState<MediaKind | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);

  const list = useMemo(
    () => filter === "all" ? MEDIA_FILES : MEDIA_FILES.filter((f) => f.kind === filter),
    [filter],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: MEDIA_FILES.length };
    for (const k of ["image", "video", "document", "spreadsheet", "audio"]) {
      c[k] = MEDIA_FILES.filter((f) => f.kind === k).length;
    }
    return c;
  }, []);

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>素材看板</h1>
          <div className="sub">跨群組多模態資料集中檢視 · 共 {MEDIA_FILES.length} 個檔案 · 由 LINE 群組自動同步</div>
        </div>
      </div>

      <div className="ml-filters">
        {KIND_FILTERS.map((k) => (
          <button
            key={k}
            className={`ml-filter${filter === k ? " active" : ""}`}
            onClick={() => setFilter(k)}
          >
            {k === "all" ? "全部" : KIND_LABEL[k]}
            <span className="ml-filter-count">{counts[k]}</span>
          </button>
        ))}
      </div>

      <div className="ml-grid">
        {list.map((f) => (
          <button
            key={f.id}
            className={`ml-card${selected === f.id ? " active" : ""}`}
            onClick={() => setSelected(selected === f.id ? null : f.id)}
          >
            <div className="ml-card-thumb">
              <span className="ml-card-icon" aria-hidden>{KIND_ICON[f.kind]}</span>
              <span className="ml-card-ext mono">.{f.ext}</span>
            </div>
            <div className="ml-card-name">{f.name}</div>
            <div className="ml-card-meta">
              <span>{f.dept}</span>
              <span className="ml-card-dot">·</span>
              <span>{f.uploader}</span>
            </div>
            <div className="ml-card-foot mono">
              <span>{fmtDate(f.uploadedAt)}</span>
              <span>{fmtSize(f.sizeKB)}</span>
            </div>
            {f.meta && <div className="ml-card-desc">{f.meta}</div>}
          </button>
        ))}
      </div>
    </>
  );
}
