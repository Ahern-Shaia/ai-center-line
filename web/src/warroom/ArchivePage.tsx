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
    catch (e) { toast.show(e instanceof ApiError ? e.message : "載入存查失敗", "danger"); }
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
            <button className="btn btn-sm" onClick={onBack}>← 任務看板</button>
            <span style={{ marginLeft: 10 }}>存查</span>
          </h1>
          <div className="sub">
            公告 / 已完成 / 已忽略 · 不需核對的紀錄 · 偶爾查閱
            {/* 有篩選時不能只寫「共 N 筆」—— 會被讀成「總共就這麼多」 */}
            {data ? ` · ${hasFilter ? "符合條件" : "共"} ${total.toLocaleString()} 筆` : ""}
          </div>
        </div>
        <button className="btn" onClick={() => void load()} disabled={loading}>重新整理</button>
      </div>

      {/* 篩選列 · 與素材看板同一組條件與同一組樣式（用戶 2026-08-25 裁定日期＋群組） */}
      <div className="ml-filterbar">
        <div className="hdr-group ml-filter-search">
          <label className="hdr-label" htmlFor="arc-kw">關鍵字</label>
          <div className="nc-tb-search">
            <span className="ic" aria-hidden>⌕</span>
            <input
              id="arc-kw" className="tf" value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="搜尋任務摘要"
            />
          </div>
        </div>
        <div className="hdr-group">
          <label className="hdr-label" htmlFor="arc-from">開始日期</label>
          <input
            id="arc-from" type="date" className="tf" value={from}
            max={to || getTaipeiDate()}
            onChange={(e) => applyFilter(() => setFrom(e.target.value))}
            disabled={loading}
          />
        </div>
        <div className="hdr-group">
          <label className="hdr-label" htmlFor="arc-to">結束日期</label>
          <input
            id="arc-to" type="date" className="tf" value={to}
            min={from || undefined} max={getTaipeiDate()}
            onChange={(e) => applyFilter(() => setTo(e.target.value))}
            disabled={loading}
          />
        </div>
        {(data?.groups.length ?? 0) > 1 && (
          <div className="hdr-group ml-filter-group">
            <span className="hdr-label">群組</span>
            <StyledSelect
              items={(data?.groups ?? []).map((g) => ({ id: g.groupId, label: g.name }))}
              value={groupId}
              onChange={(v) => applyFilter(() => setGroupId(v))}
              ariaLabel="依群組篩選"
              allowEmpty
              emptyLabel="全部群組"
              placeholder="全部群組"
              disabled={loading}
            />
          </div>
        )}
        {hasFilter && (
          <div className="hdr-group">
            <span className="hdr-label" aria-hidden>&nbsp;</span>
            <button className="btn" onClick={clearFilter} disabled={loading}>清除篩選</button>
          </div>
        )}
      </div>

      {loading && !data ? (
        <div className="dm-empty">載入存查紀錄中…</div>
      ) : total === 0 ? (
        <div className="dm-empty">
          {/* ⚠️ 有篩選時一定要先講「是篩選的關係」——
              寫「目前沒有存查紀錄」會被讀成紀錄不見了 */}
          {hasFilter ? "沒有符合條件的紀錄" : "目前沒有存查紀錄"}
          <div className="dm-empty-hint">
            {hasFilter
              ? "紀錄都還在，只是不在這個範圍裡"
              : "公告、已完成、以及您標記「不用追」的項目會收在這裡"}
          </div>
          {hasFilter && (
            <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={clearFilter}>
              清除篩選
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
                onClick={() => setPage((p) => p - 1)}>上一頁</button>
              <span className="ml-pager-at mono">第 {page} / {lastPage} 頁</span>
              <button className="btn" disabled={page >= lastPage || loading}
                onClick={() => setPage((p) => p + 1)}>下一頁</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
