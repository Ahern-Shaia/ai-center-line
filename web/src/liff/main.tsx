import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import MyDailyReport from "../personal-report/MyDailyReport";
import { ToastProvider } from "../Toast";
import { applyLiffToken, ApiError } from "../api";
import "../styles.css";

// LIFF「我的日報」React entry（M2 · 收斂方案 B）
// liff.init → getAccessToken → /auth/liff/token 換 JWT → 復用同一份 MyDailyReport（走 JWT mine* 端點）
// 徹底根除與 web 版的雙實作發散：單一元件、單一端點、單一資料路徑。
//
// ⚠️ M3 切換前置：本頁的 LIFF endpoint 必須是 .../liff.html（liff.init scope 限制）。
// 因 binding.html 已佔用現有 LIFF(2010801742-WBQkAv5t) 的 endpoint，"我的日報"需要
// 「同一支 LINE Login channel 下、endpoint 指向 /liff.html 的 LIFF app」。
// 下方 LIFF_ID 為佔位（先填現有的以利本機/型別）· M3 拿到新 LIFF app id 後更新此值 + 改 bot「日報」按鈕 URL。
const LIFF_ID = "2010801742-WBQkAv5t";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { liff: any } }

type Phase = "init" | "ready" | "unbound" | "error";

function LiffMyDailyReport() {
  const [phase, setPhase] = useState<Phase>("init");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const liff = window.liff;
        if (!liff) { setPhase("error"); setMsg("LIFF SDK 未載入 · 請重開頁面"); return; }
        await liff.init({ liffId: LIFF_ID });
        if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
        const accessToken = liff.getAccessToken();
        if (!accessToken) { setPhase("error"); setMsg("拿不到 LINE 憑證 · 請重開頁面"); return; }
        await applyLiffToken(accessToken);   // 後端驗證 → 存 JWT
        setPhase("ready");
      } catch (e) {
        // 未綁定 · /auth/liff/token 回 401 帶「尚未綁定」真實訊息
        if (e instanceof ApiError && e.status === 401) { setPhase("unbound"); setMsg(e.message); }
        else { setPhase("error"); setMsg(e instanceof Error ? e.message : "初始化失敗"); }
      }
    })();
  }, []);

  const center: React.CSSProperties = { minHeight: "70vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" };
  if (phase === "init") return <div style={center} className="dm-empty">載入中…</div>;
  if (phase === "unbound") {
    return (
      <div style={center} className="dm-empty">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>尚未完成綁定</div>
        <div className="dm-empty-hint">請先私訊公司 LINE 官方帳號、點「開始綁定」完成綁定後再開啟本頁。</div>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div style={center} className="dm-empty">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>無法開啟</div>
        <div className="dm-empty-hint">{msg}</div>
      </div>
    );
  }
  return <MyDailyReport />;
}

createRoot(document.getElementById("liff-root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <LiffMyDailyReport />
    </ToastProvider>
  </React.StrictMode>,
);
