import type { ReactNode } from "react";
import { useT } from "../i18n/useT";

// 權限設定教學 · 站內導引頁（讀者＝總經理室，電腦小白）
// 沿用「運作原理」(Onboarding) 的 .ob-* 樣式，視覺與產品一致。
// 每一步附「帶我去…」按鈕，直接跳到真實的設定頁 —— 不是模擬畫面。
//
// 對應 docs/sop/權限設定-總經理與部門主管.md（同一份內容的兩個載體）。

type GuideTarget =
  | { page: "depts"; tab?: "dept" | "member" }
  | { page: "channels" };

interface Props {
  onNavigate: (t: GuideTarget) => void;
  onDone: () => void;
}

function svg(children: ReactNode) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
  );
}

export default function PermissionSetupGuide({ onNavigate, onDone }: Props) {
  const tr = useT();
  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>{tr("psg.title")}</h1>
          <div className="sub">{tr("psg.sub")}</div>
        </div>
        <div className="actions">
          <button className="btn" onClick={onDone}>{tr("psg.close")}</button>
        </div>
      </div>

      {/* 觀念：兩種身分看到的範圍 */}
      <div className="psg-concept">
        <div className="psg-concept-h">{tr("psg.conceptH")}</div>
        <table className="psg-tbl">
          <thead>
            <tr><th>{tr("psg.colRole")}</th><th>{tr("psg.colWho")}</th><th>{tr("psg.colSees")}</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="psg-pill psg-pill-all">{tr("role.tenant_admin")}</span></td>
              <td>{tr("psg.gmWho")}</td>
              <td>{tr("psg.gmSees")}</td>
            </tr>
            <tr>
              <td><span className="psg-pill psg-pill-dept">{tr("role.group_owner")}</span></td>
              <td>{tr("psg.ownerWho")}</td>
              <td>{tr("psg.ownerSees")}</td>
            </tr>
            <tr>
              <td><span className="psg-pill psg-pill-emp">{tr("role.employee")}</span></td>
              <td>{tr("psg.empWho")}</td>
              <td>{tr("psg.empSees")}</td>
            </tr>
          </tbody>
        </table>
        <div className="psg-note">
          {tr("psg.scopeNote")}
        </div>
      </div>

      <div className="ob-steps">
        {/* 步驟 1 · 建部門 */}
        <div className="ob-step">
          <div className="ob-num"><span className="mono">01</span></div>
          <div className="ob-body">
            <div className="ob-head">
              <span className="ob-icon" aria-hidden>{svg(<>
                <rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" />
              </>)}</span>
              <span className="ob-title">{tr("psg.s1")}</span>
            </div>
            <div className="ob-desc">
              {tr("psg.d1a")}
              {tr("psg.d1b")}
            </div>
            <button className="btn btn-primary psg-go" onClick={() => onNavigate({ page: "depts", tab: "dept" })}>
              {tr("psg.go1")}
            </button>
          </div>
          <div className="ob-arrow" aria-hidden>↓</div>
        </div>

        {/* 步驟 2 · 建主管 */}
        <div className="ob-step">
          <div className="ob-num"><span className="mono">02</span></div>
          <div className="ob-body">
            <div className="ob-head">
              <span className="ob-icon" aria-hidden>{svg(<>
                <circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
              </>)}</span>
              <span className="ob-title">{tr("psg.s2")}</span>
            </div>
            <div className="ob-desc">
              {tr("psg.d2a")}
              {tr("psg.d2b")}
            </div>
            <div className="psg-warn">
              {tr("psg.w2")}
            </div>
            <div className="ob-desc" style={{ marginTop: 10 }}>
              {tr("psg.d2c")}
              {tr("psg.d2d")}
              {tr("psg.d2e")}
            </div>
            <button className="btn btn-primary psg-go" onClick={() => onNavigate({ page: "depts", tab: "member" })}>
              {tr("psg.go2")}
            </button>
          </div>
          <div className="ob-arrow" aria-hidden>↓</div>
        </div>

        {/* 步驟 3 · 分派群組 */}
        <div className="ob-step">
          <div className="ob-num"><span className="mono">03</span></div>
          <div className="ob-body">
            <div className="ob-head">
              <span className="ob-icon" aria-hidden>{svg(<>
                <path d="M4 6h16v10H8l-4 4V6z" /><path d="M9 11h6" />
              </>)}</span>
              <span className="ob-title">{tr("psg.s3")}</span>
            </div>
            <div className="ob-desc">
              {tr("psg.d3a")}
              {tr("psg.d3b")}
            </div>
            <div className="psg-warn">
              {tr("psg.w3")}
            </div>
            <button className="btn btn-primary psg-go" onClick={() => onNavigate({ page: "channels" })}>
              {tr("psg.go3")}
            </button>
          </div>
        </div>
      </div>

      {/* 常見問題 */}
      <div className="psg-faq">
        <div className="psg-concept-h">{tr("psg.faqH")}</div>
        {[
          ["psg.q1", "psg.a1"],
          ["psg.q2", "psg.a2"],
          ["psg.q3", "psg.a3"],
          ["psg.q4", "psg.a4"],
        ].map(([q, a]) => (
          <details key={tr(q)} className="psg-qa">
            <summary>{tr(q)}</summary>
            <div>{tr(a)}</div>
          </details>
        ))}
      </div>

      <div className="ob-cta">
        <div>
          <div className="ob-cta-h">{tr("psg.ctaH")}</div>
          <div className="ob-cta-sub">{tr("psg.ctaSub")}</div>
        </div>
        <button className="btn btn-primary" onClick={() => onNavigate({ page: "depts", tab: "dept" })}>開始設定</button>
      </div>
    </>
  );
}
