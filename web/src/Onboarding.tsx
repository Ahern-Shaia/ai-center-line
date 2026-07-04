interface Props { onDone: () => void }

const STEPS = [
  {
    n: 1,
    title: "LINE 群組不改變",
    icon: "💬",
    body: "工廠員工照常在既有 LINE 群組報工、回報維修、傳照片影片。不用改行為、不用學新工具。",
    detail: "系統以官方帳號加入您的群組，收到訊息即時保存原始內容（含所有照片、影片、檔案）。",
  },
  {
    n: 2,
    title: "每晚在您廠內脫敏",
    icon: "🌙",
    body: "每晚定時處理：先在您公司內部把人名、電話、車牌等敏感資料遮罩後才進入分析。原始對照表始終留在您這裡。",
    detail: "遮罩對照表只存在您的伺服器，AI 分析階段完全看不到真實個資。",
  },
  {
    n: 3,
    title: "AI 分析且每一句都能反查",
    icon: "🧠",
    body: "分類、抽取、聚類、對應主檔、知識整理、信心度評分六路並行。每筆結果都能反查對應的原始 LINE 訊息。",
    detail: "缺漏欄位一律留白，絕不猜測；對應您的員工 / 機台 / 工單主檔逐筆比對。",
  },
  {
    n: 4,
    title: "人工簽核 · AI 不代決策",
    icon: "✍",
    body: "總經理室或群組負責人在戰情室查看每日 AI 產出，逐筆簽核。低信心的項目自動攔截，須補資訊才能簽。",
    detail: "誰簽的、什麼時候簽的、有沒有被顧問代簽，全部紀錄可稽核。",
  },
  {
    n: 5,
    title: "簽核後才同步 Ragic",
    icon: "🔄",
    body: "只有簽核後的資料才會寫進您的 Ragic ERP。錯誤或未確認的內容不會流出戰情室。",
    detail: "同步失敗會清楚顯示並可一鍵重跑，確保跨系統資料一致。",
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
                <span className="ob-detail-lbl">保障重點</span>
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
          <div className="ob-cta-sub">戰情室已載入本日案例，登入即可查看</div>
        </div>
        <button className="btn btn-primary" onClick={onDone}>進戰情室</button>
      </div>
    </>
  );
}
