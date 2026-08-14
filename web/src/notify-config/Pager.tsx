// 分頁列 · 規格：docs/mockup/notify-rules-B-flat.html / notify-logs-B.html 的 .pager
//
// 用數字頁碼而不是「第 1 / 5 頁 ‹ ›」：mockup 兩頁都畫數字，而且 legend #1 的理由是
// 「左側永遠顯示第 X–Y 筆，共 N 筆，不用自己數」—— 能直接跳第 3 頁是這個理由的一半。

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/** 頁碼視窗：頭尾一定在，當前頁左右各一，中間斷開處放 …（mockup：1 2 3 … 10）*/
function pageItems(page: number, pageCount: number): Array<number | "gap"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const keep = new Set([1, pageCount, page, page - 1, page + 1]);
  const out: Array<number | "gap"> = [];
  for (let p = 1; p <= pageCount; p++) {
    if (keep.has(p)) out.push(p);
    else if (out[out.length - 1] !== "gap") out.push("gap");
  }
  return out;
}

export default function Pager({
  page, pageCount, total, pageSize, onPage, onPageSize, summarySuffix, note,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  /** 給了才顯示「每頁 N 筆」選單（規則頁有，紀錄頁 mockup 沒有）*/
  onPageSize?: (n: number) => void;
  /** 接在「共 N 筆」後面，例如「（近 7 天）」*/
  summarySuffix?: string;
  /** 右側說明文字 · 沒有每頁筆數選單時才用得到 */
  note?: string;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="nc-pager">
      <div>第 {from}–{to} 筆，共 <b>{total}</b> 筆{summarySuffix}</div>

      <div className="nc-pages">
        <button className="nc-pg" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="上一頁">‹</button>
        {pageItems(page, pageCount).map((it, i) =>
          it === "gap" ? (
            <span key={`gap${i}`} className="nc-pg-gap">…</span>
          ) : (
            <button key={it} className={`nc-pg${it === page ? " on" : ""}`}
              aria-current={it === page ? "page" : undefined}
              onClick={() => onPage(it)}>{it}</button>
          ),
        )}
        <button className="nc-pg" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="下一頁">›</button>
      </div>

      {onPageSize ? (
        <div className="nc-psize">
          每頁
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="每頁筆數">
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          筆
        </div>
      ) : (
        <div>{note}</div>
      )}
    </div>
  );
}
