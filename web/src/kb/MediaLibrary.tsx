import { useCallback, useEffect, useState } from "react";
import {
  ApiError, deleteMedia, fetchMediaBlobUrl, getSession, listMedia, purgeMedia, restoreMedia,
  type MediaItem, type MediaKind, type MediaListResult,
} from "../api";
import ConfirmDialog from "../shared/ConfirmDialog";
import { useToast } from "../Toast";

// 素材看板 · docs/modules/media-and-vision.md §2
//
// 這頁到 2026-07-27 為止顯示的是 17 筆虛構檔案，但 LINE 群組傳的檔案其實一直有存下來
// （當時 prod 已有 135 個 · 0 失敗）——「圖片傳了就不見了」是顯示問題，不是儲存問題。
//
// 縮圖刻意不做（要多裝影像處理套件）：改成分頁 + 進到畫面才載圖，
// 沒被捲到的圖一個位元組都不會下載。

const KIND_LABEL: Record<MediaKind, string> = { image: "圖片", video: "影片", audio: "語音", file: "檔案" };
const KIND_ICON: Record<MediaKind, string> = { image: "▩", video: "▶", audio: "◉", file: "▤" };
const KIND_FILTERS: (MediaKind | "all")[] = ["all", "image", "video", "file", "audio"];

function fmtSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function displayName(f: MediaItem): string {
  if (f.filename) return f.filename;
  if (f.caption) return f.caption.length > 24 ? `${f.caption.slice(0, 24)}…` : f.caption;
  return `${KIND_LABEL[f.kind]} ${fmtDate(f.sentAt)}`;
}

/** 帶授權的縮圖 · 捲到畫面上才去要檔案，離開畫面就把記憶體還回去 */
function Thumb({ item }: { item: MediaItem }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!node || item.kind !== "image") return;
    let objectUrl: string | null = null;
    let cancelled = false;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      fetchMediaBlobUrl(item.mediaId)
        .then((u) => { if (cancelled) URL.revokeObjectURL(u); else { objectUrl = u; setUrl(u); } })
        .catch(() => { if (!cancelled) setFailed(true); });
    }, { rootMargin: "200px" });
    io.observe(node);
    return () => {
      cancelled = true;
      io.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [node, item.mediaId, item.kind]);

  if (item.kind === "image" && !failed) {
    return (
      <div className="ml-card-thumb ml-thumb-img" ref={setNode}>
        {url ? <img src={url} alt={displayName(item)} /> : <span className="ml-thumb-load" aria-hidden />}
      </div>
    );
  }
  return (
    <div className="ml-card-thumb">
      <span className="ml-card-icon" aria-hidden>{KIND_ICON[item.kind]}</span>
      <span className="ml-card-ext mono">{failed ? "無法顯示" : KIND_LABEL[item.kind]}</span>
    </div>
  );
}

export default function MediaLibrary() {
  const toast = useToast();
  const [filter, setFilter] = useState<MediaKind | "all">("all");
  const [page, setPage] = useState(1);
  const [trash, setTrash] = useState(false);
  const [data, setData] = useState<MediaListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{ item: MediaItem; mode: "delete" | "purge" } | null>(null);
  const [busy, setBusy] = useState(false);

  const role = getSession()?.role;
  const canDelete = role === "tenant_admin" || role === "consultant" || role === "aiproot_admin";
  const canPurge = role === "aiproot_admin";

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await listMedia(filter, page, trash)); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "載入失敗", "danger"); }
    finally { setLoading(false); }
  }, [filter, page, trash, toast]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, okMsg: string) {
    setBusy(true);
    try {
      await fn();
      toast.show(okMsg, "ok");
      setConfirm(null);
      await load();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "操作失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  const counts = data?.counts;
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 24;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <div className="pane-hdr">
        <div>
          {/* 標題要跟著換 —— 只改副標的話，切過去第一眼看不出自己在哪一頁 */}
          <h1>{trash ? "素材看板 · 已刪除" : "素材看板"}</h1>
          <div className="sub">
            {trash
              ? "已刪除的檔案會保留 30 天，期限內可以還原，到期後自動清除"
              : "LINE 群組傳的照片與檔案自動保存於此"}
            {counts ? ` · 共 ${counts.all.toLocaleString()} 個檔案` : ""}
          </div>
        </div>
        {canDelete && (
          <div className="hdr-toolbar">
            <button
              className={`btn${trash ? " btn-primary" : ""}`}
              onClick={() => { setTrash(!trash); setPage(1); setFilter("all"); }}
              disabled={loading}
            >
              {trash ? "回到素材看板" : "已刪除"}
            </button>
          </div>
        )}
      </div>

      {/* 數量拿到才畫按鈕列：數量 0 的類型不顯示（點了必定空白＝雜訊），
          先畫再抽掉會讓使用者看到按鈕憑空消失。目前選中的即使變 0 也留著。 */}
      {counts && (
        <div className="ml-filters">
          {KIND_FILTERS.filter((k) => k === "all" || k === filter || counts[k] > 0).map((k) => (
            <button
              key={k}
              className={`ml-filter${filter === k ? " active" : ""}`}
              onClick={() => { setFilter(k); setPage(1); }}
              disabled={loading}
            >
              {k === "all" ? "全部" : KIND_LABEL[k]}
              <span className="ml-filter-count">{counts[k]}</span>
            </button>
          ))}
        </div>
      )}

      {loading && !data ? (
        <div className="dm-empty">載入中…</div>
      ) : total === 0 ? (
        <div className="dm-empty">
          {trash
            ? "沒有已刪除的檔案"
            : filter === "all" ? "還沒有任何檔案" : `沒有${KIND_LABEL[filter as MediaKind]}類型的檔案`}
          <div className="dm-empty-hint">
            {trash
              ? "刪除的檔案會先放在這裡，30 天內都還救得回來"
              : "群組裡傳的照片、影片、檔案會自動出現在這裡（貼圖不保存）"}
          </div>
        </div>
      ) : (
        <>
          <div className="ml-grid">
            {data?.items.map((f) => (
              <div key={f.mediaId} className="ml-card">
                <Thumb item={f} />
                <div className="ml-card-name" title={f.filename ?? f.caption ?? ""}>{displayName(f)}</div>
                <div className="ml-card-meta">
                  <span>{f.departmentName ?? f.groupName ?? "未分派部門"}</span>
                  {f.senderName && <><span className="ml-card-dot">·</span><span>{f.senderName}</span></>}
                </div>
                <div className="ml-card-foot mono">
                  <span>{fmtDate(f.sentAt)}</span>
                  <span>{fmtSize(f.sizeBytes)}</span>
                </div>
                {f.caption && f.filename && <div className="ml-card-desc">{f.caption}</div>}

                {trash ? (
                  <div className="ml-card-act">
                    <span className={`ml-card-left${(f.daysLeft ?? 0) <= 3 ? " urgent" : ""}`}>
                      {(f.daysLeft ?? 0) === 0 ? "今天到期" : `還剩 ${f.daysLeft} 天`}
                      {f.deletedByName ? ` · ${f.deletedByName} 刪除` : ""}
                    </span>
                    <button className="btn" disabled={busy}
                      onClick={() => void run(() => restoreMedia(f.mediaId), "已還原")}>
                      還原
                    </button>
                    {canPurge && (
                      <button className="btn danger" disabled={busy}
                        onClick={() => setConfirm({ item: f, mode: "purge" })}>
                        立即清除
                      </button>
                    )}
                  </div>
                ) : canDelete && (
                  <div className="ml-card-act">
                    <button className="btn" disabled={busy}
                      onClick={() => setConfirm({ item: f, mode: "delete" })}>
                      刪除
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {lastPage > 1 && (
            <div className="ml-pager">
              <button className="btn" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>上一頁</button>
              <span className="ml-pager-at mono">第 {page} / {lastPage} 頁</span>
              <button className="btn" disabled={page >= lastPage || loading} onClick={() => setPage((p) => p + 1)}>下一頁</button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        onClose={() => !busy && setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          void (confirm.mode === "purge"
            ? run(() => purgeMedia(confirm.item.mediaId), "已徹底清除")
            : run(() => deleteMedia(confirm.item.mediaId), "已刪除，30 天內可還原"));
        }}
        busy={busy}
        tone="danger"
        title={confirm?.mode === "purge" ? "徹底清除這個檔案？" : "刪除這個檔案？"}
        confirmLabel={confirm?.mode === "purge" ? "徹底清除" : "刪除"}
        body={confirm && (
          <>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{displayName(confirm.item)}</div>
            {confirm.mode === "purge" ? (
              <p>檔案會立刻從儲存空間移除，<b>無法還原</b>。系統會留下「這個檔案被誰在何時清除」的紀錄。</p>
            ) : (
              <p>檔案會從素材看板移除，<b>30 天內都可以在「已刪除」裡還原</b>，到期後自動清除。</p>
            )}
            {/* 一定要講：使用者對「刪除」的直覺是「收回」，但 LINE 不讓 bot 收回別人的訊息 */}
            <p style={{ color: "var(--ink-3)", fontSize: 12.5, marginTop: 8 }}>
              請注意：這只會移除系統裡的副本，<b>LINE 群組裡的那則訊息仍然存在</b>，
              需要另外請群組成員自行收回。
            </p>
          </>
        )}
      />
    </>
  );
}
