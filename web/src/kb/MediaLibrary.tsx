import Spinner from "../shared/Spinner";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError, deleteMedia, fetchMediaBlobUrl, getSession, listMedia, purgeMedia, restoreMedia,
  type MediaItem, type MediaKind, type MediaListResult,
  downloadMedia,
} from "../api";
import ConfirmDialog from "../shared/ConfirmDialog";
import StyledSelect from "../shared/StyledSelect";
import { getTaipeiDate } from "../shared/taipeiDate";
import { useDebounced } from "../shared/useDebounced";
import { useToast } from "../Toast";
import { useT } from "../i18n/useT";

// 素材看板 · docs/modules/media-and-vision.md §2
//
// 這頁到 2026-07-27 為止顯示的是 17 筆虛構檔案，但 LINE 群組傳的檔案其實一直有存下來
// （當時 prod 已有 135 個 · 0 失敗）——「圖片傳了就不見了」是顯示問題，不是儲存問題。
//
// 縮圖刻意不做（要多裝影像處理套件）：改成分頁 + 進到畫面才載圖，
// 沒被捲到的圖一個位元組都不會下載。

const KIND_LABEL: Record<MediaKind, string> = { image: "ml.image", video: "ml.video", audio: "ml.audio", file: "ml.file" };
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
  const tr = useT();
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
      <span className="ml-card-ext mono">{failed ? tr("ml.cantShow") : tr(KIND_LABEL[item.kind])}</span>
    </div>
  );
}

export default function MediaLibrary() {
  const tr = useT();
  const toast = useToast();
  const [filter, setFilter] = useState<MediaKind | "all">("all");
  const [page, setPage] = useState(1);
  const [trash, setTrash] = useState(false);
  // 日期＋群組篩選（台灣福祉 ② · 2026-08-25 裁定「先這兩個」）
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupId, setGroupId] = useState("");
  // 關鍵字要 debounce —— 這是打 server 的搜尋，每個按鍵一次請求既浪費也會亂序
  const [kw, setKw] = useState("");
  const q = useDebounced(kw);
  const [data, setData] = useState<MediaListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{ item: MediaItem; mode: "delete" | "purge" } | null>(null);
  const [busy, setBusy] = useState(false);

  const role = getSession()?.role;
  const canDelete = role === "tenant_admin" || role === "consultant" || role === "aiproot_admin";
  const canPurge = role === "aiproot_admin";

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await listMedia(filter, page, trash, { from, to, groupId, q })); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : tr("common.loadFailed"), "danger"); }
    finally { setLoading(false); }
  }, [filter, page, trash, from, to, groupId, q, toast]);
  useEffect(() => { void load(); }, [load]);
  // 關鍵字是 debounce 後才送出的，回第一頁要跟著 q 走而不是跟著打字
  useEffect(() => { setPage(1); }, [q]);

  /** 改任何一個篩選都要回第一頁 —— 不然會停在第 5 頁而新條件只有 2 頁，看到空白 */
  const applyFilter = (fn: () => void) => { fn(); setPage(1); };
  const hasFilter = !!(from || to || groupId || kw);
  const clearFilter = () => applyFilter(() => { setFrom(""); setTo(""); setGroupId(""); setKw(""); });

  async function run(fn: () => Promise<unknown>, okMsg: string) {
    setBusy(true);
    try {
      await fn();
      toast.show(okMsg, "ok");
      setConfirm(null);
      await load();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : tr("ml.opFailed"), "danger");
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
          <h1>{trash ? tr("ml.titleTrash") : tr("nav.media")}</h1>
          <div className="sub">
            {trash
              ? tr("ml.subTrash")
              : tr("ml.sub")}
            {/* 有篩選時不能只寫「共 N 個」—— 那會被讀成「總共就這麼多」，
                看起來像檔案不見了 */}
            {counts ? ` · ${tr(hasFilter ? "ml.matchN" : "ml.totalN", { n: counts.all.toLocaleString() })}` : ""}
          </div>
        </div>
        {canDelete && (
          <div className="hdr-toolbar">
            <button
              className={`btn${trash ? " btn-primary" : ""}`}
              /* 篩選一併清掉：兩個清單的群組選項不一樣，
                 帶著「只有素材才有的那一群」切過來會直接是空白畫面 */
              onClick={() => { setTrash(!trash); setPage(1); setFilter("all"); clearFilter(); }}
              disabled={loading}
            >
              {trash ? tr("ml.backToMedia") : tr("ml.trash")}
            </button>
          </div>
        )}
      </div>

      {/* 關鍵字＋日期＋群組篩選（台灣福祉 ②）
          · 群組下拉只在真的有兩群以上時出現（只有一群時選它沒有意義）
          · 關鍵字比對「檔名 OR 圖片前後三分鐘的訊息」—— 照片沒有檔名，
            光比檔名的話客戶想找的那張報價單永遠搜不到 */}
      <div className="ml-filterbar">
        <div className="hdr-group ml-filter-search">
          <label className="hdr-label" htmlFor="ml-kw">{tr("ml.keyword")}</label>
          <div className="nc-tb-search">
            <span className="ic" aria-hidden>⌕</span>
            <input
              id="ml-kw" className="tf" value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder={tr("ml.keywordPh")}
            />
          </div>
        </div>
        <div className="hdr-group">
          <label className="hdr-label" htmlFor="ml-from">{tr("ml.from")}</label>
          <input
            id="ml-from" type="date" className="tf" value={from}
            max={to || getTaipeiDate()}
            onChange={(e) => applyFilter(() => setFrom(e.target.value))}
            disabled={loading}
          />
        </div>
        <div className="hdr-group">
          <label className="hdr-label" htmlFor="ml-to">{tr("ml.to")}</label>
          <input
            id="ml-to" type="date" className="tf" value={to}
            min={from || undefined} max={getTaipeiDate()}
            onChange={(e) => applyFilter(() => setTo(e.target.value))}
            disabled={loading}
          />
        </div>
        {(data?.groups.length ?? 0) > 1 && (
          <div className="hdr-group ml-filter-group">
            <span className="hdr-label">{tr("col.group")}</span>
            <StyledSelect
              items={(data?.groups ?? []).map((g) => ({ id: g.groupId, label: g.name }))}
              value={groupId}
              onChange={(v) => applyFilter(() => setGroupId(v))}
              ariaLabel={tr("ml.byGroup")}
              allowEmpty
              emptyLabel={tr("ml.allGroups")}
              placeholder={tr("ml.allGroups")}
              disabled={loading}
            />
          </div>
        )}
        {hasFilter && (
          <div className="hdr-group">
            {/* 佔位讓按鈕跟上面的輸入框對齊底線 */}
            <span className="hdr-label" aria-hidden>&nbsp;</span>
            <button className="btn" onClick={clearFilter} disabled={loading}>{tr("ml.clearFilter")}</button>
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
              {k === "all" ? tr("audit.all") : tr(KIND_LABEL[k])}
              <span className="ml-filter-count">{counts[k]}</span>
            </button>
          ))}
        </div>
      )}

      {loading && !data ? (
        <Spinner block />
      ) : total === 0 ? (
        <div className="dm-empty">
          {/* ⚠️ 有篩選時一定要先講「是篩選的關係」——
              寫「還沒有任何檔案」會被讀成檔案不見了，那是最糟的誤會 */}
          {hasFilter
            ? tr("ml.emptyFiltered")
            : trash
              ? tr("ml.emptyTrash")
              : filter === "all" ? tr("ml.emptyAll") : tr("ml.emptyKind", { kind: tr(KIND_LABEL[filter as MediaKind]) })}
          <div className="dm-empty-hint">
            {hasFilter
              ? tr("ml.emptyFilteredHint")
              : trash
                ? tr("ml.emptyTrashHint")
                : tr("ml.emptyAllHint")}
          </div>
          {hasFilter && (
            <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={clearFilter}>
              {tr("ml.clearFilter")}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="ml-grid">
            {data?.items.map((f) => (
              <div key={f.mediaId} className="ml-card">
                <Thumb item={f} />
                <div className="ml-card-name" title={f.filename ?? f.caption ?? ""}>{displayName(f)}</div>
                <div className="ml-card-meta">
                  <span>{f.departmentName ?? f.groupName ?? tr("gc.noDeptPill")}</span>
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
                      {(f.daysLeft ?? 0) === 0 ? tr("ml.expiresToday") : tr("ml.daysLeft", { n: f.daysLeft ?? 0 })}
                      {f.deletedByName ? ` · ${tr("ml.deletedBy", { who: f.deletedByName })}` : ""}
                    </span>
                    <button className="btn" disabled={busy}
                      onClick={() => void run(() => restoreMedia(f.mediaId), tr("ml.restored"))}>
                      {tr("ml.restore")}
                    </button>
                    {canPurge && (
                      <button className="btn danger" disabled={busy}
                        onClick={() => setConfirm({ item: f, mode: "purge" })}>
                        {tr("ml.purge")}
                      </button>
                    )}
                  </div>
                ) : (
                  /* ⚠️ 下載給**所有看得到素材的人**（media:view），不要綁在 canDelete 裡 ——
                     那是刪除權限，跟能不能把檔案存下來是兩件事 */
                  <div className="ml-card-act">
                    <button className="btn" disabled={busy}
                      /* 不走 run()：那個 helper 會 setConfirm(null) + 重載整份清單，
                         下載不需要動到畫面（重載反而會讓捲動位置跳掉） */
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await downloadMedia(f.mediaId, f.filename);
                        } catch (e) {
                          toast.show(e instanceof ApiError ? e.message : tr("ml.downloadFailed"), "danger");
                        } finally {
                          setBusy(false);
                        }
                      }}>
                      {tr("ml.download")}
                    </button>
                    {canDelete && (
                      <button className="btn" disabled={busy}
                        onClick={() => setConfirm({ item: f, mode: "delete" })}>
                        {tr("common.delete")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {lastPage > 1 && (
            <div className="ml-pager">
              <button className="btn" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>{tr("common.prevPage")}</button>
              <span className="ml-pager-at mono">{tr("ml.pageOf", { n: page, total: lastPage })}</span>
              <button className="btn" disabled={page >= lastPage || loading} onClick={() => setPage((p) => p + 1)}>{tr("common.nextPage")}</button>
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
            ? run(() => purgeMedia(confirm.item.mediaId), tr("ml.purged"))
            : run(() => deleteMedia(confirm.item.mediaId), tr("ml.deleted")));
        }}
        busy={busy}
        tone="danger"
        title={tr(confirm?.mode === "purge" ? "ml.purgeTitle" : "ml.deleteTitle")}
        confirmLabel={tr(confirm?.mode === "purge" ? "ml.purge" : "common.delete")}
        body={confirm && (
          <>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{displayName(confirm.item)}</div>
            {confirm.mode === "purge" ? (
              <p>{tr("ml.purgeBody")}</p>
            ) : (
              <p>{tr("ml.deleteBody")}</p>
            )}
            {/* 一定要講：使用者對「刪除」的直覺是「收回」，但 LINE 不讓 bot 收回別人的訊息 */}
            <p style={{ color: "var(--ink-3)", fontSize: 12.5, marginTop: 8 }}>
              {tr("ml.deleteNote1")}
              {tr("ml.deleteNote2")}
            </p>
          </>
        )}
      />
    </>
  );
}
