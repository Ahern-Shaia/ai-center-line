import type { ReactNode } from "react";

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
  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>權限設定教學</h1>
          <div className="sub">設定成「總經理看全公司、各部門主管只看自己部門」· 照著點，約 10 分鐘</div>
        </div>
        <div className="actions">
          <button className="btn" onClick={onDone}>關閉</button>
        </div>
      </div>

      {/* 觀念：兩種身分看到的範圍 */}
      <div className="psg-concept">
        <div className="psg-concept-h">先搞懂：身分決定看得到多少</div>
        <table className="psg-tbl">
          <thead>
            <tr><th>畫面上的身分</th><th>這是誰</th><th>看得到</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="psg-pill psg-pill-all">總經理室</span></td>
              <td>老闆、管理層</td>
              <td><b>全公司</b>所有部門</td>
            </tr>
            <tr>
              <td><span className="psg-pill psg-pill-dept">群組負責人</span></td>
              <td>各部門主管</td>
              <td><b>只有他自己那一個部門</b></td>
            </tr>
            <tr>
              <td><span className="psg-pill psg-pill-emp">員工</span></td>
              <td>一般同仁</td>
              <td>只有他自己的日報</td>
            </tr>
          </tbody>
        </table>
        <div className="psg-note">
          範圍限制由系統自動處理，主管<b>不可能</b>點到別部門的資料 —— 設錯也不會外洩，放心。
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
              <span className="ob-title">先把「部門」建好</span>
            </div>
            <div className="ob-desc">
              主管要綁到部門，所以部門要先存在。到「部門 / 成員」的<b>部門</b>分頁，
              按「＋ 新增部門」，把業務部、技術部、售後服務部等一個個建起來。
            </div>
            <button className="btn btn-primary psg-go" onClick={() => onNavigate({ page: "depts", tab: "dept" })}>
              帶我去建部門 →
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
              <span className="ob-title">建立各部門主管（設成「群組負責人」）</span>
            </div>
            <div className="ob-desc">
              切到<b>成員</b>分頁 → 「＋ 新增成員」。角色選「<b>群組負責人</b>」，
              並在「<b>所屬部門</b>」選他負責的那個部門。填 Email、顯示名稱、初始密碼即可。
            </div>
            <div className="psg-warn">
              ⚠️ <b>「所屬部門」一定要選。</b>沒選的主管，系統會保守處理成「幾乎看不到東西」（不是看全部）。
            </div>
            <button className="btn btn-primary psg-go" onClick={() => onNavigate({ page: "depts", tab: "member" })}>
              帶我去新增成員 →
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
              <span className="ob-title">把 LINE 群組分派到部門</span>
            </div>
            <div className="ob-desc">
              這一步決定「哪個 LINE 群的對話，算哪個部門的任務」。到「通訊管道」的
              <b> LINE 群組</b>分頁，每個群右邊的「部門」下拉選好。上方若顯示「N 群未分派部門」，就是還沒選完。
            </div>
            <div className="psg-warn">
              ⚠️ 沒做這步，主管的部門會是<b>空的</b> —— 對話進不到他的部門。
            </div>
            <button className="btn btn-primary psg-go" onClick={() => onNavigate({ page: "channels" })}>
              帶我去分派群組 →
            </button>
          </div>
        </div>
      </div>

      {/* 常見問題 */}
      <div className="psg-faq">
        <div className="psg-concept-h">設錯時對照這裡</div>
        {[
          ["部門主管登入後什麼都看不到？", "最常見是忘了選「所屬部門」。回成員分頁編輯他，把所屬部門補上。"],
          ["部門主管看得到別部門的資料？", "檢查他的角色是不是被設成「總經理室」了 —— 那個身分本來就看全公司。改成「群組負責人」。"],
          ["一位主管同時管兩個部門？", "目前一個人只能綁一個部門。要同時看兩個，只能給「總經理室」（但會看到全公司），或請 AIPROOT 評估。"],
          ["現在好像每個人都看得到全部？", "因為多數帳號目前是「總經理室」。把該當主管的人逐一改成「群組負責人」並指定部門即可。"],
        ].map(([q, a]) => (
          <details key={q} className="psg-qa">
            <summary>{q}</summary>
            <div>{a}</div>
          </details>
        ))}
      </div>

      <div className="ob-cta">
        <div>
          <div className="ob-cta-h">準備好開始設定了嗎？</div>
          <div className="ob-cta-sub">建議照 1 → 2 → 3 的順序做</div>
        </div>
        <button className="btn btn-primary" onClick={() => onNavigate({ page: "depts", tab: "dept" })}>開始設定</button>
      </div>
    </>
  );
}
