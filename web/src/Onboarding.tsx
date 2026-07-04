interface Props { onDone: () => void }

const STEPS = [
  {
    n: 1,
    title: "LINE 群組不改變",
    icon: "💬",
    body: "工廠員工照常在既有 LINE 群組報工、回報維修、傳照片影片。不用改行為、不用學新工具。",
    detail: "官方帳號拉進群→ webhook 訂閱事件；所有訊息（含照片/影片/檔案）進來立即落地保存。",
  },
  {
    n: 2,
    title: "每日批次 · 地端去識別",
    icon: "🌙",
    body: "每晚定時批次：先在您廠內去識別（人名、電話、車牌 token 化），敏感資料不離廠。",
    detail: "本地 NER + 規則遮罩 → 存 raw + pseudo；對照表只留您這裡，抽取階段用 pseudo。",
  },
  {
    n: 3,
    title: "AI 六路分析 · 每句可追溯",
    icon: "🧠",
    body: "分類 / 抽取 / 聚類 / grounding / 知識抽取 / 信心度評分。每筆結果都掛 source_ids 反查原訊息。",
    detail: "Claude Opus 分階；抽取欄位缺漏一律 null，不臆測；grounding 對照主檔（員工/機台/工單）。",
  },
  {
    n: 4,
    title: "人工簽核 · AI 不代決策",
    icon: "✍",
    body: "總經理室 / 群組負責人在戰情室看到今日 AI 產出，逐筆簽核；低信心自動攔截，須補資訊才可簽。",
    detail: "簽核狀態機：待簽核 → 已簽核 / 已駁回 / 攔截補件；proxy 簽核（顧問代簽）有徽章 + audit。",
  },
  {
    n: 5,
    title: "簽核後才同步 Ragic",
    icon: "🔄",
    body: "已簽核的結構化資料才寫進您的 Ragic ERP。錯的資料不會流出戰情室外。",
    detail: "Outbox 冪等重試；同步失敗顯示徽章可重跑；跨系統一致性保障。",
  },
];

export default function Onboarding({ onDone }: Props) {
  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>戰情室運作原理</h1>
          <div className="sub">5 分鐘看懂從 LINE 到 Ragic 的完整流程</div>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={onDone}>進戰情室</button>
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
                <span className="ob-title">{s.title}</span>
              </div>
              <div className="ob-desc">{s.body}</div>
              <div className="ob-detail">
                <span className="ob-detail-lbl">技術細節</span>
                {s.detail}
              </div>
            </div>
            {i < STEPS.length - 1 && <div className="ob-arrow" aria-hidden>↓</div>}
          </div>
        ))}
      </div>

      <div className="ob-cta">
        <div>
          <div className="ob-cta-h">準備好看實際運作了嗎？</div>
          <div className="ob-cta-sub">戰情室已載入台灣福祉科技的 demo 資料（假名化）</div>
        </div>
        <button className="btn btn-primary" onClick={onDone}>進戰情室</button>
      </div>
    </>
  );
}
