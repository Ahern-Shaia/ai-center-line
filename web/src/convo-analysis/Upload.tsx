import { useState } from "react";
import { createConvoUpload, ApiError } from "../api";
import { useToast } from "../Toast";

interface Props {
  onUploaded: (id: number) => void;
}

export default function ConversationAnalysisUpload({ onUploaded }: Props) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [tenantSlug] = useState<"twh">("twh"); // pilot 只支援 twh
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string>("");

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f) {
      const text = await f.text();
      setPreview(text.slice(0, 500));
    } else {
      setPreview("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.show("請先選擇檔案", "danger");
      return;
    }
    setUploading(true);
    try {
      const raw = await file.text();
      if (raw.length < 10) {
        toast.show("檔案內容過短、請確認 LINE 匯出格式", "danger");
        return;
      }
      if (raw.length > 500_000) {
        toast.show("檔案過大 (>500 KB)、請分段", "danger");
        return;
      }
      const res = await createConvoUpload({
        filename: file.name,
        rawContent: raw,
        tenantSlug,
      });
      toast.show(`上傳成功 · 分析中（uploadId=${res.id}）`, "ok");
      onUploaded(res.id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "上傳失敗";
      toast.show(msg, "danger");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="pane">
      <h1>上傳 LINE 對話</h1>
      <p style={{ color: "#666", marginTop: 4 }}>
        選擇 LINE 匯出的 <code>.txt</code> 檔（zh-TW 格式、12h 上午/下午、Tab 分隔）· AI 會分類 + 抽出結構化日報 + 事件記錄。
      </p>

      <form onSubmit={handleSubmit} style={{ marginTop: 24, maxWidth: 720 }}>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
            LINE 對話檔案 <span style={{ color: "#c00" }}>*</span>
          </label>
          <input
            type="file"
            accept=".txt,text/plain"
            onChange={handleFileChange}
            disabled={uploading}
            style={{ display: "block", padding: 8, border: "1px solid #ccc", borderRadius: 4, width: "100%" }}
          />
          {file && (
            <div style={{ marginTop: 8, fontSize: 13, color: "#666" }}>
              已選 <b>{file.name}</b> · {(file.size / 1024).toFixed(1)} KB
            </div>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>租戶</label>
          <select
            value={tenantSlug}
            disabled
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4, width: "100%" }}
          >
            <option value="twh">台灣福祉（twh）</option>
          </select>
          <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
            pilot 階段只支援 twh 主檔 grounding · 未來擴 tenant registry
          </div>
        </div>

        {preview && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>檔案預覽（前 500 字）</label>
            <pre
              style={{
                background: "#f5f5f5",
                padding: 12,
                borderRadius: 4,
                fontSize: 12,
                maxHeight: 200,
                overflow: "auto",
                border: "1px solid #ddd",
              }}
            >
              {preview}
              {preview.length >= 500 && "\n... (略)"}
            </pre>
          </div>
        )}

        <button
          type="submit"
          disabled={!file || uploading}
          style={{
            padding: "10px 24px",
            background: uploading ? "#999" : "#0066cc",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: uploading ? "wait" : "pointer",
            fontSize: 14,
          }}
        >
          {uploading ? "上傳中..." : "上傳並分析"}
        </button>
      </form>

      <div style={{ marginTop: 32, padding: 16, background: "#fef7e6", borderLeft: "4px solid #f0a500", borderRadius: 4 }}>
        <strong>提示</strong>
        <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20, fontSize: 13, color: "#555" }}>
          <li>分析需 60-90 秒（呼 Claude API）· 上傳完成後自動跳到列表 · 狀態變 <b>done</b> 才能看結果</li>
          <li>檔案上限 500 KB（~5000 訊息）· 超過請分批</li>
          <li>訊息會存 Postgres · 30 天後自動刪原檔（PII cleanup）</li>
        </ul>
      </div>
    </div>
  );
}
