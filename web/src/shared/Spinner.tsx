import { useT } from "../i18n/useT";
// 品牌載入指示 · 對齊 brand-pilot.html 動效（primary 環 · 600ms linear · 尊重 prefers-reduced-motion）
// 取代散落各頁的純文字「載入中…」（brand-pilot §動效原則列為反例：三態必齊、別卡純文字）。
//   <Spinner block />        整頁/整區載入（置中 + 環 + 文字）
//   <Spinner label="…" />    行內小型（環 + 文字）
export default function Spinner({ label, block = false }: { label?: string; block?: boolean }) {
  return (
    <div className={block ? "spinner-block" : "spinner-inline"} role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      {label && <span className="spinner-lbl">{label}</span>}
    </div>
  );
}
