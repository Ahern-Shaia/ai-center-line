import { useCallback, useEffect, useRef, useState } from "react";
import { listConvoUploads, type ConvoUpload, ApiError } from "../api";
import { useToast } from "../Toast";

interface Props {
  onOpen: (id: number) => void;
  onNewUpload: () => void;
}

const STATUS_LABEL: Record<ConvoUpload["status"], string> = {
  pending: "排隊中",
  running: "分析中",
  done: "已完成",
  failed: "失敗",
};

const STATUS_COLOR: Record<ConvoUpload["status"], string> = {
  pending: "#999",
  running: "#0088cc",
  done: "#2b9348",
  failed: "#c62828",
};

export default function ConversationAnalysisList({ onOpen, onNewUpload }: Props) {
  const [uploads, setUploads] = useState<ConvoUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchUploads = useCallback(async () => {
    try {
      const res = await listConvoUploads();
      setUploads(res.uploads);
      setError(null);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "載入失敗";
      setError(msg);
      toast.show(msg, "danger");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchUploads();
  }, [fetchUploads]);

  // Poll every 5s if 有任何 pending/running
  useEffect(() => {
    const hasActive = uploads.some((u) => u.status === "pending" || u.status === "running");
    if (hasActive && !pollingRef.current) {
      pollingRef.current = setInterval(fetchUploads, 5000);
    } else if (!hasActive && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [uploads, fetchUploads]);

  return (
    <div className="pane">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0 }}>AI 對話分析</h1>
          <p style={{ color: "#666", marginTop: 4, marginBottom: 0 }}>
            上傳歷史 · 點列查看抽取結果、標對錯、看 metric
          </p>
        </div>
        <button
          onClick={onNewUpload}
          style={{
            padding: "10px 20px",
            background: "#0066cc",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          + 上傳新對話
        </button>
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: "#999" }}>載入中...</div>}
      {error && (
        <div style={{ padding: 16, background: "#fee", borderLeft: "4px solid #c62828", borderRadius: 4 }}>
          {error}
        </div>
      )}

      {!loading && !error && uploads.length === 0 && (
        <div style={{ padding: 60, textAlign: "center", color: "#999", background: "#fafafa", borderRadius: 8 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 16, marginBottom: 20 }}>尚無分析記錄</div>
          <button
            onClick={onNewUpload}
            style={{
              padding: "10px 24px",
              background: "#0066cc",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            上傳第一份對話
          </button>
        </div>
      )}

      {!loading && uploads.length > 0 && (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            background: "white",
            border: "1px solid #e0e0e0",
            borderRadius: 4,
          }}
        >
          <thead>
            <tr style={{ background: "#f5f5f5", borderBottom: "2px solid #e0e0e0" }}>
              <th style={{ padding: 12, textAlign: "left", fontWeight: 500 }}>#</th>
              <th style={{ padding: 12, textAlign: "left", fontWeight: 500 }}>檔名</th>
              <th style={{ padding: 12, textAlign: "left", fontWeight: 500 }}>租戶</th>
              <th style={{ padding: 12, textAlign: "left", fontWeight: 500 }}>訊息數</th>
              <th style={{ padding: 12, textAlign: "left", fontWeight: 500 }}>狀態</th>
              <th style={{ padding: 12, textAlign: "left", fontWeight: 500 }}>上傳時間</th>
              <th style={{ padding: 12, textAlign: "right", fontWeight: 500 }}>動作</th>
            </tr>
          </thead>
          <tbody>
            {uploads.map((u) => (
              <tr
                key={u.id}
                style={{
                  borderBottom: "1px solid #eee",
                  cursor: u.status === "done" ? "pointer" : "default",
                }}
                onClick={() => u.status === "done" && onOpen(u.id)}
              >
                <td style={{ padding: 12, color: "#999" }}>#{u.id}</td>
                <td style={{ padding: 12 }}>{u.filename}</td>
                <td style={{ padding: 12, color: "#666" }}>{u.tenantSlug}</td>
                <td style={{ padding: 12, color: "#666" }}>
                  {u.messageCount ?? "-"} 訊息 / {u.segmentCount ?? "-"} 段
                </td>
                <td style={{ padding: 12 }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 10px",
                      background: STATUS_COLOR[u.status],
                      color: "white",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  >
                    {STATUS_LABEL[u.status]}
                  </span>
                  {u.errorMessage && (
                    <div style={{ fontSize: 11, color: "#c62828", marginTop: 4 }}>{u.errorMessage}</div>
                  )}
                </td>
                <td style={{ padding: 12, color: "#666", fontSize: 12 }}>
                  {new Date(u.uploadedAt).toLocaleString("zh-TW", { hour12: false })}
                </td>
                <td style={{ padding: 12, textAlign: "right" }}>
                  {u.status === "done" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(u.id);
                      }}
                      style={{
                        padding: "6px 12px",
                        background: "white",
                        border: "1px solid #0066cc",
                        color: "#0066cc",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      查看結果
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
