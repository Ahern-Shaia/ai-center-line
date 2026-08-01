import Spinner from "../../shared/Spinner";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getOrgOverview, ApiError, type OrgOverview, type OrgMember } from "../../api";
import { useToast } from "../../Toast";

// 組織關係圖（org-overview M1）· 資料驅動 · 三招：座標用量不用排（getBoundingClientRect 畫 SVG）、
// 成員溢位收合（主管+4 其餘「＋N 位」）、部門多水平捲。對照 docs/modules/org-overview.md §5。
const PALETTE = [
  { c: "#4F46E5", c2: "#6366F1", t: "#EEF2FF" }, { c: "#0D9488", c2: "#14B8A6", t: "#ECFDF5" },
  { c: "#D97706", c2: "#F59E0B", t: "#FFFBEB" }, { c: "#DB2777", c2: "#EC4899", t: "#FDF2F8" },
  { c: "#0284C7", c2: "#0EA5E9", t: "#EFF6FF" },
];
const MAX = 5;

interface Edge { d: string; stroke: string }
function bez(x1: number, y1: number, x2: number, y2: number, stroke: string): Edge {
  const dy = Math.max(28, (y2 - y1) * 0.5);
  return { d: `M${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`, stroke };
}

export default function OrgGraph({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<OrgOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [edges, setEdges] = useState<Edge[]>([]);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const clampZoom = (z: number) => Math.min(1.4, Math.max(0.4, Math.round(z * 20) / 20));

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getOrgOverview(tenantId)
      .then((d) => { if (alive) { setData(d); setExpanded(new Set()); } })
      .catch((e) => toast.show(e instanceof ApiError ? e.message : "載入組織圖失敗", "danger"))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tenantId, toast]);

  const draw = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const host = stage.getBoundingClientRect();
    // stage 被 transform:scale 後，getBoundingClientRect 回的是縮放後座標；除以 zoom 還原成
    // stage 內部原生座標，SVG 用原生座標畫、再隨 stage 一起縮放 → 線條精準貼合、不會雙重縮放。
    const rel = (el: Element) => {
      const a = el.getBoundingClientRect();
      return {
        xc: (a.left - host.left + a.width / 2) / zoom,
        top: (a.top - host.top) / zoom,
        bot: (a.top - host.top + a.height) / zoom,
      };
    };
    const es: Edge[] = [];
    const co = stage.querySelector("[data-og='company']");
    const gm = stage.querySelector("[data-og='gm']");
    if (co && gm) { const a = rel(co), b = rel(gm); es.push(bez(a.xc, a.bot, b.xc, b.top, "#7C3AED")); }
    stage.querySelectorAll("[data-dept]").forEach((deptEl) => {
      const di = Number((deptEl as HTMLElement).dataset.dept);
      const p = PALETTE[di % PALETTE.length];
      const anchor = gm ?? co;
      if (anchor) { const a = rel(anchor), b = rel(deptEl); es.push(bez(a.xc, a.bot, b.xc, b.top, "#7C3AED")); }
      const d = rel(deptEl);
      stage.querySelectorAll(`[data-mem='${di}']`).forEach((mEl) => {
        const m = rel(mEl); es.push(bez(d.xc, d.bot, m.xc, m.top, p.c));
      });
    });
    setEdges(es);
    setDim({ w: stage.scrollWidth, h: stage.scrollHeight });
  }, [zoom]);

  useLayoutEffect(() => { draw(); }, [data, expanded, zoom, draw]);

  const fitAll = useCallback(() => {
    const el = scrollRef.current;
    if (el && dim.w) setZoom(clampZoom((el.clientWidth - 4) / dim.w));
  }, [dim.w]);
  // 部門多會超出視窗 · 載入後把水平捲動置中，開啟時看到的是「置中的組織圖」而非漂在一邊（跑版感來源）。
  // 只在資料變更時置中，不在展開/收合時重置捲動位置。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
  }, [data, dim.w, zoom]);
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
      <div className="og-zoom">
        <button onClick={() => setZoom((z) => clampZoom(z - 0.15))} disabled={zoom <= 0.4} aria-label="縮小">－</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => clampZoom(z + 0.15))} disabled={zoom >= 1.4} aria-label="放大">＋</button>
        <button className="fit" onClick={fitAll}>全覽</button>
      </div>
      <div className="og-scroll" ref={scrollRef}>
        <div className="og-zoomwrap" style={{ width: dim.w * zoom, height: dim.h * zoom }}>
          <div className="og-stage" ref={stageRef} style={{ transform: `scale(${zoom})` }}>
            <svg className="og-edges" width={dim.w} height={dim.h}>
          {edges.map((e, i) => (
            <path key={i} d={e.d} stroke={e.stroke} strokeWidth={2} fill="none" opacity={0.45} />
          ))}
        </svg>
        <div className="og-layer">
          <div className="og-band">
            <div className="og-company" data-og="company"><div className="t">公司</div><div className="n">{data.company}</div></div>
            {data.gm.length > 0 && (
              <div className="og-gm" data-og="gm">
                <span className="av">{data.gm[0][0] ?? "？"}</span>
                <span><span className="n">{data.gm.join("、")}</span><br /><span className="r">總經理室 · 看全公司</span></span>
              </div>
            )}
          </div>

          <div className="og-lanes">
            {data.departments.map((d, di) => {
              const p = PALETTE[di % PALETTE.length];
              const over = d.members.length > MAX;
              const isExp = expanded.has(di);
              const shown = !over || isExp ? d.members : d.members.slice(0, MAX);
              return (
                <div className="og-lane" key={di}>
                  <div className="og-dept" data-dept={di}>
                    <div className="bar" style={{ background: `linear-gradient(90deg,${p.c},${p.c2})` }} />
                    <div className="body">
                      <span className="cnt">{d.members.length} 位</span>
                      <div className="n">{d.name}</div>
                      {d.groups.length > 0
                        ? d.groups.map((g, gi) => <span key={gi} className="grp" style={{ color: p.c, background: p.t }}>◍ {g}</span>)
                        : <span className="grp warn">◍ 未接 LINE 群</span>}
                    </div>
                  </div>
                  <div className="og-members">
                    {shown.map((m, mi) => <MemberNode key={mi} m={m} di={di} p={p} />)}
                    {over && (
                      <div className="og-more" data-mem={di} onClick={() => toggle(di)}>
                        {isExp ? "收合 ▲" : `＋${d.members.length - MAX} 位…`}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

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
          </div>
        </div>
      </div>
    </div>
  );
}

function MemberNode({ m, di, p }: { m: OrgMember; di: number; p: { c: string; c2: string } }) {
  const lead = m.role === "group_owner";
  return (
    <div className={`og-mem${lead ? " lead" : ""}${!m.hasLineBinding ? " warn" : ""}`} data-mem={di}>
      <span className="av" style={{ background: `linear-gradient(135deg,${p.c},${p.c2})` }}>{m.name[0] ?? "？"}</span>
      <span className="nm">{m.name}</span>
      {lead && <span className="og-badge" style={{ background: p.c }}>主管</span>}
      {!m.hasLineBinding && <span className="og-nolink">未綁</span>}
    </div>
  );
}
