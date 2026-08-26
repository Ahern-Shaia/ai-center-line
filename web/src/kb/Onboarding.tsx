import type { ReactNode } from "react";
import { useT } from "../i18n/useT";

interface Props { onDone: () => void }

interface Step {
  n: number;
  title: string;
  icon: ReactNode;
  body: string;
  detail: string;
}

// SVG icons · 1.6 stroke · 20×20 · currentColor（吃 primary indigo）
function svgIcon(children: ReactNode) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const STEPS: Step[] = [
  {
    n: 1,
    title: "ob.s1.title",
    icon: svgIcon(<>
      <path d="M4 6h16v10H8l-4 4V6z" />
      <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" />
    </>),
    body: "ob.s1.body",
    detail: "ob.s1.detail",
  },
  {
    n: 2,
    title: "ob.s2.title",
    icon: svgIcon(<>
      <path d="M12 2 3 6v6c0 5 3.5 8 9 10 5.5-2 9-5 9-10V6l-9-4z" />
      <path d="m9 12 2 2 4-4" />
    </>),
    body: "ob.s2.body",
    detail: "ob.s2.detail",
  },
  {
    n: 3,
    title: "ob.s3.title",
    icon: svgIcon(<>
      <circle cx="6" cy="7" r="2" />
      <circle cx="6" cy="17" r="2" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="m8 8 8 3M8 16l8-3" />
    </>),
    body: "ob.s3.body",
    detail: "ob.s3.detail",
  },
  {
    n: 4,
    title: "ob.s4.title",
    icon: svgIcon(<>
      <path d="m4 20 4-1 10-10-3-3L5 16l-1 4z" />
      <path d="m14 6 3 3" />
      <path d="M13 20h8" />
    </>),
    body: "ob.s4.body",
    detail: "ob.s4.detail",
  },
  {
    n: 5,
    title: "ob.s5.title",
    icon: svgIcon(<>
      <path d="M20 8a8 8 0 0 0-14-3L4 7" />
      <path d="M4 3v4h4" />
      <path d="M4 16a8 8 0 0 0 14 3l2-2" />
      <path d="M20 21v-4h-4" />
    </>),
    body: "ob.s5.body",
    detail: "ob.s5.detail",
  },
];

export default function Onboarding({ onDone }: Props) {
  const tr = useT();
  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>{tr("ob.title")}</h1>
          <div className="sub">{tr("ob.sub")}</div>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={onDone}>{tr("ob.enter")}</button>
        </div>
      </div>

      <div className="ob-steps">
        {STEPS.map((s, i) => (
          <div key={s.n} className="ob-step">
            <div className="ob-num">
              <span className="mono">{String(s.n).padStart(2, "0")}</span>
            </div>
            <div className="ob-body">
              <div className="ob-head">
                <span className="ob-icon" aria-hidden>{s.icon}</span>
                <span className="ob-title">{tr(s.title)}</span>
              </div>
              <div className="ob-desc">{tr(s.body)}</div>
              <div className="ob-detail">
                <span className="ob-detail-lbl">{tr("ob.detailLbl")}</span>
                {tr(s.detail)}
              </div>
            </div>
            {i < STEPS.length - 1 && <div className="ob-arrow" aria-hidden>↓</div>}
          </div>
        ))}
      </div>

      <div className="ob-cta">
        <div>
          <div className="ob-cta-h">{tr("ob.ctaH")}</div>
          <div className="ob-cta-sub">{tr("ob.ctaSub")}</div>
        </div>
        <button className="btn btn-primary" onClick={onDone}>{tr("ob.enter")}</button>
      </div>
    </>
  );
}
