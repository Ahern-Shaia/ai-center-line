import { useCallback, useEffect, useState } from "react";
import {
  ApiError, getArchivedTasks,
  type ArchivedTasksResult, type WarroomKanbanTicket,
} from "../api";
import { useToast } from "../Toast";
import StyledSelect from "../shared/StyledSelect";
import { getTaipeiDate } from "../shared/taipeiDate";
import { useDebounced } from "../shared/useDebounced";
import { ArchivedList } from "./TaskTriage";
import { t } from "../i18n";
import { useT } from "../i18n/useT";

// 存查次頁 · 台灣福祉 ⑥（M3b）
//
// 從 TaskBoard 拆出來的：那個檔已經 732 行，而存查要自己的分頁狀態與篩選狀態，
// 塞回去只會讓兩個不相干的東西共用一堆 useState。
//
// ⚠️ 這頁**不吃**看板那份 `board.kanban.archived` —— 那是從「最近 500 筆」切出來的前 50 筆。
//    存查的用途正好是「找回三個月前那件事」，是唯一一個必須看得到舊資料的頁面。

export default function ArchivePage({
  onBack, onOpen, onDecided,
}: {
  onBack: () => void;
  onOpen: (t: WarroomKanbanTicket) => void;
  /** 改列待辦之後要讓主看板也重載 —— 那張票會回到待核對欄 */
  onDecided: () => void;
}) {
  const toast = useToast();
  const tr = useT();
  const [data, setData] = useState<ArchivedTasksResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupId, setGroupId] = useState("");
  // 打字要打 server，一定要 debounce（見 useDebounced 的註解）
  const [kw, setKw] = useState("");
  const q = useDebounced(kw);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getArchivedTasks(page, { from, to, groupId, q })); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : t("arc.loadFailed"), "danger"); }
    finally { setLoading(false); }
  }, [page, from, to, groupId, q, toast]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [q]);

  /** 改任何篩選都要回第一頁 —— 不然會停在第 5 頁而新條件只有 2 頁，看到空白 */
  const applyFilter = (fn: () => void) => { fn(); setPage(1); };
  const hasFilter = !!(from || to || groupId || kw);
  const clearFilter = () => applyFilter(() => { setFrom(""); setTo(""); setGroupId(""); setKw(""); });

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>
            <button className="btn btn-sm" onClick={onBack}>{tr("arc.back")}</button>
            <span style={{ marginLeft: 10 }}>{tr("arc.title")}</span>
          </h1>
          <div className="sub">
            {tr("arc.sub")}
            {/* 有篩選時不能只寫「共 N 筆」—— 會被讀成「總共就這麼多」 */}
            {data ? ` · ${tr(hasFilter ? "arc.countFiltered" : "arc.countAll", { n: total.toLocaleString() })}` : ""}
          </div>
        </div>
        <button className="btn" onClick={() => void load()} disabled={loading}>{tr("common.refresh")}</button>
      </div>

      {/* 篩選列 · 與素材看板同一組條件與同一組樣式（用戶 2026-08-25 裁定日期＋群組） */}
      <div className="ml-filterbar">
        <div className="hdr-group ml-filter-search">
          <label className="hdr-label" htmlFor="arc-kw">{tr("filter.keyword")}</label>
          <div className="nc-tb-search">
            <span className="ic" aria-hidden>⌕</span>
            <input
              id="arc-kw" className="tf" value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder={tr("arc.searchPlaceholder")}
            />
          </div>
        </div>
        <div className="hdr-group">
          <label className="hdr-label" htmlFor="arc-from">{tr("filter.from")}</label>
          <input
            id="arc-from" type="date" className="tf" value={from}
            max={to || getTaipeiDate()}
            onChange={(e) => applyFilter(() => setFrom(e.target.value))}
            disabled={loading}
          />
        </div>
        <div className="hdr-group">
          <label className="hdr-label" htmlFor="arc-to">{tr("filter.to")}</label>
          <input
            id="arc-to" type="date" className="tf" value={to}
            min={from || undefined} max={getTaipeiDate()}
            onChange={(e) => applyFilter(() => setTo(e.target.value))}
            disabled={loading}
          />
        </div>
        {(data?.groups.length ?? 0) > 1 && (
          <div className="hdr-group ml-filter-group">
            <span className="hdr-label">{tr("filter.group")}</span>
            <StyledSelect
              items={(data?.groups ?? []).map((g) => ({ id: g.groupId, label: g.name }))}
              value={groupId}
              onChange={(v) => applyFilter(() => setGroupId(v))}
              ariaLabel={tr("filter.byGroup")}
              allowEmpty
              emptyLabel={tr("filter.allGroups")}
              placeholder={tr("filter.allGroups")}
              disabled={loading}
            />
          </div>
        )}
        {hasFilter && (
          <div className="hdr-group">
            <span className="hdr-label" aria-hidden>&nbsp;</span>
            <button className="btn" onClick={clearFilter} disabled={loading}>{tr("filter.clear")}</button>
          </div>
        )}
      </div>

      {loading && !data ? (
        <div className="dm-empty">{tr("arc.loading")}</div>
      ) : total === 0 ? (
        <div className="dm-empty">
          {/* ⚠️ 有篩選時一定要先講「是篩選的關係」——
              寫「目前沒有存查紀錄」會被讀成紀錄不見了 */}
          {tr(hasFilter ? "arc.emptyFiltered" : "arc.empty")}
          <div className="dm-empty-hint">
            {hasFilter
              ? tr("arc.emptyFilteredHint")
              : tr("arc.emptyHint")}
          </div>
          {hasFilter && (
            <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={clearFilter}>
              {tr("filter.clear")}
            </button>
          )}
        </div>
      ) : (
        <>
          <ArchivedList
            tickets={data?.items ?? []}
            onOpen={onOpen}
            onDecided={() => { void load(); onDecided(); }}
          />
          {lastPage > 1 && (
            <div className="ml-pager">
              <button className="btn" disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}>{tr("pager.prev")}</button>
              <span className="ml-pager-at mono">{tr("pager.at", { page, last: lastPage })}</span>
              <button className="btn" disabled={page >= lastPage || loading}
                onClick={() => setPage((p) => p + 1)}>{tr("pager.next")}</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
