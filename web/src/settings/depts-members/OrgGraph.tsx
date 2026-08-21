import Spinner from "../../shared/Spinner";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getOrgOverview, ApiError, GROUP_TYPE_LABEL, type OrgOverview, type OrgMember, type LineGroupType } from "../../api";
import { useToast } from "../../Toast";

// 組織關係圖（org-overview M1 → 2026-08-21 改左右樹）· 資料驅動 · 座標用量不用排。
// 版型依據：docs/mockup/org-chart-horizontal.html（用戶 2026-08-21 選定 C）
// 研究依據：docs/modules/design-research-org-chart-layout.md
//
// ⭐ 為什麼從上下樹改成左右樹：13 個部門排成一列＝2900px 寬，視窗放不下，
//    只能縮到 40% —— 而 40% 時部門名剩 6px、成員名剩 4.4px，看得到形狀讀不到內容。
//    轉 90 度之後「寬淺樹」變「窄深樹」：13 列 × 約 56px ≈ 730px 高，而網頁本來就垂直捲。
//    順帶解掉長標籤問題（節點寬度 196px → 296px，「福祉集團-業務二部(含售服)」一行放得下）。
const PALETTE = [
  { c: "#4F46E5", c2: "#6366F1", t: "#EEF2FF" }, { c: "#0D9488", c2: "#14B8A6", t: "#ECFDF5" },
  { c: "#D97706", c2: "#F59E0B", t: "#FFFBEB" }, { c: "#DB2777", c2: "#EC4899", t: "#FDF2F8" },
  { c: "#0284C7", c2: "#0EA5E9", t: "#EFF6FF" },
];
const MAX = 5;

interface Edge { d: string; stroke: string }
// 垂直連線（公司 → 總經理室，兩者上下疊在左欄）
function bezV(x1: number, y1: number, x2: number, y2: number, stroke: string): Edge {
  const dy = Math.max(14, (y2 - y1) * 0.5);
  return { d: `M${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`, stroke };
}
// 水平連線（總經理室 → 各部門）· 左右樹的好處：全部從同一點分岔，不需要跨列長曲線
function bezH(x1: number, y1: number, x2: number, y2: number, stroke: string): Edge {
  const dx = Math.max(16, (x2 - x1) * 0.55);
  return { d: `M${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, stroke };
}

type Lod = "all" | "dept";

export default function OrgGraph({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<OrgOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [edges, setEdges] = useState<Edge[]>([]);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  const [lod, setLod] = useState<Lod>("all");
  const [q, setQ] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getOrgOverview(tenantId)
      .then((d) => { if (alive) { setData(d); setExpanded(new Set()); } })
      .catch((e) => toast.show(e instanceof ApiError ? e.message : "載入組織圖失敗", "danger"))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tenantId, toast]);

  // 篩選：部門名 / LINE 群名 / 成員名 任一命中就留下這個部門
  // 13 個部門已經到了「用找的比用看的快」的規模（研究 §4）
  const shownIdx = useMemo(() => {
    if (!data) return [];
    const kw = q.trim().toLowerCase();
    return data.departments
      .map((_, i) => i)
      .filter((i) => {
        if (!kw) return true;
        const d = data.departments[i]!;
        return d.name.toLowerCase().includes(kw)
          || d.groups.some((g) => g.toLowerCase().includes(kw))
          || d.members.some((m) => m.name.toLowerCase().includes(kw));
      });
  }, [data, q]);

  const draw = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const host = grid.getBoundingClientRect();
    // 不再有 transform:scale，量到的就是實際座標，不必還原
    const box = (el: Element) => {
      const a = el.getBoundingClientRect();
      return {
        left: a.left - host.left, right: a.right - host.left,
        xc: a.left - host.left + a.width / 2,
        top: a.top - host.top, bot: a.top - host.top + a.height,
        yc: a.top - host.top + a.height / 2,
      };
    };
    const es: Edge[] = [];
    const co = grid.querySelector("[data-og='company']");
    const gm = grid.querySelector("[data-og='gm']");
    if (co && gm) { const a = box(co), b = box(gm); es.push(bezV(a.xc, a.bot, b.xc, b.top, "#7C3AED")); }
    const anchor = gm ?? co;
    if (anchor) {
      const a = box(anchor);
      grid.querySelectorAll("[data-dept]").forEach((deptEl) => {
        const di = Number((deptEl as HTMLElement).dataset.dept);
        const b = box(deptEl);
        es.push(bezH(a.right, a.yc, b.left, b.yc, PALETTE[di % PALETTE.length]!.c));
      });
    }
    // ⚠️ 刻意不畫「部門 → 成員」的線：成員就排在該部門那一列的右邊，
    //    對齊與顏色已經表達了歸屬，再加線只會讓畫面變雜（mockup 也是這樣定的）。
    setEdges(es);
    setDim({ w: grid.scrollWidth, h: grid.scrollHeight });
  }, []);

  useLayoutEffect(() => { draw(); }, [data, expanded, lod, shownIdx, draw]);
  useEffect(() => {
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  if (loading && !data) return <Spinner block />;
  if (!data) return <div className="dm-empty">無法載入組織圖</div>;

  const toggle = (di: number) => setExpanded((s) => {
    const n = new Set(s); if (n.has(di)) n.delete(di); else n.add(di); return n;
  });
  const hasOrphan = data.unassigned.members.length > 0 || data.unassigned.groups.length > 0;

  return (
    <div className="og-wrap">
      <div className="og-bar">
        {/* 分層顯示 · 研究 §4「progressive disclosure」· 部門一多時先看骨架 */}
        <div className="og-seg">
          <button className={lod === "all" ? "on" : ""} onClick={() => setLod("all")}>部門＋成員</button>
          <button className={lod === "dept" ? "on" : ""} onClick={() => setLod("dept")}>只看部門</button>
        </div>
        <input
          className="og-srch" type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋部門或成員…" aria-label="搜尋部門或成員"
        />
      </div>

      <div className="og-grid" ref={gridRef}>
        <svg className="og-edges" width={dim.w} height={dim.h}>
          {edges.map((e, i) => (
            <path key={i} d={e.d} stroke={e.stroke} strokeWidth={1.6} fill="none" opacity={0.38} />
          ))}
        </svg>

        <div className="og-root">
          <div className="og-company" data-og="company"><div className="t">公司</div><div className="n">{data.company}</div></div>
          {data.gm.length > 0 && (
            <div className="og-gm" data-og="gm">
              <span className="av">{data.gm[0][0] ?? "？"}</span>
              <span><span className="n">{data.gm.join("、")}</span><br /><span className="r">總經理室 · 看全公司</span></span>
            </div>
          )}
        </div>

        <div className="og-rows">
          {shownIdx.map((di) => {
            const d = data.departments[di]!;
            const p = PALETTE[di % PALETTE.length]!;
            const over = d.members.length > MAX;
            const isExp = expanded.has(di);
            const shown = !over || isExp ? d.members : d.members.slice(0, MAX);
            return (
              <div className="og-row" key={di}>
                <div className="og-dept" data-dept={di}>
                  <span className="lbar" style={{ background: `linear-gradient(180deg,${p.c},${p.c2})` }} />
                  <span className="txt">
                    <span className="n">{d.name}</span>
                    {d.groups.length > 0
                      ? d.groups.map((g, gi) => <span key={gi} className="grp" style={{ color: p.c, background: p.t }}>◍ {g}</span>)
                      : <span className="grp warn">◍ 未接 LINE 群</span>}
                  </span>
                  <span className="cnt">{d.members.length} 位</span>
                </div>
                {lod === "all" && (
                  <div className="og-mems">
                    {shown.map((m, mi) => <MemberNode key={mi} m={m} p={p} />)}
                    {/* 溢位收合仍保留 —— 版型換了，但「一部門 20 人」那個壓測情境沒有消失 */}
                    {over && (
                      <button className="og-more" onClick={() => toggle(di)}>
                        {isExp ? "收合 ▲" : `＋${d.members.length - MAX} 位…`}
                      </button>
                    )}
                    {d.members.length === 0 && <span className="og-none">— 尚無成員</span>}
                  </div>
                )}
              </div>
            );
          })}
          {shownIdx.length === 0 && (
            <div className="dm-empty" style={{ padding: "26px 0" }}>
              找不到符合「{q}」的部門或成員
            </div>
          )}
        </div>
      </div>

      {/* 0068 · 跨部門群組 —— 仍然分析、仍然出任務，只是不宣稱「這些人屬於那個部門」
          （group-type-classification.md §4.2）。放在部門樹之後、未分派之前。 */}
      {data.crossGroups.length > 0 && (
        <div className="og-cross">
          <div className="t">跨部門群組 · {data.crossGroups.length} 個</div>
          <div className="s">
            這些群的成員橫跨多個部門，<b>不代表組織歸屬</b>，所以不畫進上面的部門樹、
            也不計入部門健康度的分母。但它們<b>照常分析、照常產出任務</b>。
          </div>
          <div className="og-cross-list">
            {data.crossGroups.map((g, i) => (
              <div className="og-cross-item" key={i}>
                <div className="n">
                  {g.name}
                  <span className={`og-cross-badge ${g.groupType}`}>
                    {GROUP_TYPE_LABEL[g.groupType as LineGroupType] ?? g.groupType}
                  </span>
                </div>
                <div className="m">{g.memberCount} 人</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasOrphan && (
        <div className="og-orphan">
          <div className="t">⚠ 未分派 · 導入待補</div>
          <div className="s">
            {data.unassigned.groups.length > 0 && <>群組：{data.unassigned.groups.join("、")}　</>}
            {data.unassigned.members.length > 0 && <>成員：{data.unassigned.members.map((m) => m.name).join("、")}（系統推不出部門）</>}
          </div>
        </div>
      )}
    </div>
  );
}

function MemberNode({ m, p }: { m: OrgMember; p: { c: string; c2: string } }) {
  const lead = m.role === "group_owner";
  return (
    <span className={`og-mem${lead ? " lead" : ""}${!m.hasLineBinding ? " warn" : ""}`}>
      <span className="av" style={{ background: `linear-gradient(135deg,${p.c},${p.c2})` }}>{m.name[0] ?? "？"}</span>
      <span className="nm">{m.name}</span>
      {lead && <span className="og-badge" style={{ background: p.c }}>主管</span>}
      {!m.hasLineBinding && <span className="og-nolink">未綁</span>}
    </span>
  );
}
