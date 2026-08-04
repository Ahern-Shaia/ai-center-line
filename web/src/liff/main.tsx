import Spinner from "../shared/Spinner";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import MyDailyReport from "../personal-report/MyDailyReport";
import { ToastProvider } from "../Toast";
import { applyLiffToken, ApiError } from "../api";
import BindingView from "./BindingView";
import SetPasswordView from "./SetPasswordView";
import PunchView from "./PunchView";
import MyTrips from "../personal-report/MyTrips";
import type { LiffCtx } from "./types";
import "../styles.css";

// LIFF 統一入口（M2 · 收斂方案 B）· 取代 binding.html 三視圖
// 綁定 / 設密碼 / 我的日報 都在此 React 應用，讀 ?page + ?botId 路由。
// 「我的日報」復用同一份 MyDailyReport（走 JWT）· 徹底根除雙實作發散。
//
// ⚠️ M3 切換：把「現有」LIFF(2010801742-WBQkAv5t) 的 Endpoint URL 改成 .../liff.html 即可，
// bot 按鈕 URL 不用改（同一支 LIFF · 只是背後頁面換 React 版）。
//
// 0060 · 這只是**預設值**。LINE 的 userId 依 provider 發放，不同 provider 的 messaging
// channel 必須配自己 provider 的 LIFF，否則綁定會寫進一個永遠對不上 webhook 的 ID。
// 所以真正要用哪支 LIFF 由 bot 決定（後端 buildLiffUrl 帶 ?liffId= 進來）。
// 詳見 docs/modules/liff-multi-provider.md
const DEFAULT_LIFF_ID = "2010801742-WBQkAv5t";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { liff: any } }

// botId 在 liff.login 導向來回可能被剝掉/搬進 liff.state → 登入前先持久化（同 binding.html 修正）
function resolveQuery(key: string): string | null {
  const q = new URLSearchParams(location.search);
  let v = q.get(key);
  if (v) return v;
  const liffState = q.get("liff.state");
  if (liffState) {
    const s = new URLSearchParams(liffState.startsWith("?") ? liffState.slice(1) : liffState);
    v = s.get(key);
    if (v) return v;
  }
  const hash = location.hash.replace(/^#/, "");
  if (hash) { const h = new URLSearchParams(hash); v = h.get(key); if (v) return v; }
  return null;
}

type Phase = "init" | "binding" | "set-password" | "mine" | "punch" | "trips" | "unbound" | "error";

const CENTER: React.CSSProperties = { minHeight: "70vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" };

// 三個 LIFF 頁共用 liff.html，其 <title> 只是預設值 → 依實際頁面切換，
// 否則使用者從「我的行程」開啟卻看到標題寫「我的日報」。
const PHASE_TITLE: Partial<Record<Phase, string>> = {
  mine: "我的日報",
  trips: "我的行程",
  punch: "外勤打卡",
  binding: "員工綁定",
  "set-password": "設定密碼",
};

function LiffApp() {
  const [phase, setPhase] = useState<Phase>("init");
  const [ctx, setCtx] = useState<LiffCtx | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const t = PHASE_TITLE[phase];
    if (t) document.title = t;
  }, [phase]);

  useEffect(() => {
    (async () => {
      try {
        const liff = window.liff;
        if (!liff) { setPhase("error"); setMsg("LIFF SDK 未載入 · 請重開頁面"); return; }

        // 登入前先解析並持久化 botId/page/liffId（liff.login 導向來回會把 query 剝掉）
        const botId = resolveQuery("botId") || sessionStorage.getItem("liff_bot_id") || "";
        const page = resolveQuery("page") || sessionStorage.getItem("liff_page") || "binding";
        // ⚠️ 只有在 botId 也對得上時才敢沿用存起來的 liffId ——
        //    否則「從 bot A 開過、再從沒設 liff_id 的 bot B 開」會拿 A 的 LIFF 去 init，
        //    等於又跨回錯的 provider。對不上就退回預設。
        const storedBotId = sessionStorage.getItem("liff_bot_id");
        const liffId = resolveQuery("liffId")
          || (botId && botId === storedBotId ? sessionStorage.getItem("liff_id") : null)
          || DEFAULT_LIFF_ID;
        if (botId) {
          sessionStorage.setItem("liff_bot_id", botId);
          sessionStorage.setItem("liff_page", page);
          sessionStorage.setItem("liff_id", liffId);
        }

        await liff.init({ liffId });

        if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
        const accessToken = liff.getAccessToken();
        if (!accessToken) { setPhase("error"); setMsg("拿不到 LINE 憑證 · 請重開頁面"); return; }
        const profile = await liff.getProfile();

        // JWT 流程（需已綁定）：我的日報、外勤打卡、我的行程
        if (page === "mine" || page === "punch" || page === "trips") {
          try {
            await applyLiffToken(accessToken, botId);   // 驗證 → JWT · botId 綁死租戶（一人多租戶）
            setPhase(page);
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) { setPhase("unbound"); setMsg(e.message); }
            else throw e;
          }
          return;
        }

        // 綁定 / 設密碼需要 botId
        if (!botId) { setPhase("error"); setMsg("缺 botId · 請透過 bot 私訊的按鈕開啟"); return; }
        setCtx({ botId, lineUserId: profile.userId, displayName: profile.displayName, pictureUrl: profile.pictureUrl ?? null, accessToken });
        setPhase(page === "set-password" ? "set-password" : "binding");
      } catch (e) {
        setPhase("error"); setMsg(e instanceof Error ? e.message : "初始化失敗");
      }
    })();
  }, []);

  if (phase === "init") return <div style={CENTER}><Spinner block /></div>;
  if (phase === "error") {
    return <div style={CENTER} className="dm-empty"><div style={{ fontWeight: 600, marginBottom: 6 }}>無法開啟</div><div className="dm-empty-hint">{msg}</div></div>;
  }
  if (phase === "unbound") {
    return <div style={CENTER} className="dm-empty"><div style={{ fontWeight: 600, marginBottom: 6 }}>尚未完成綁定</div><div className="dm-empty-hint">請先私訊公司 LINE 官方帳號、點「開始綁定」完成後再開啟本頁。</div></div>;
  }
  if (phase === "mine") return <MyDailyReport />;
  if (phase === "punch") return <PunchView />;
  if (phase === "trips") return <MyTrips />;
  // 註：分頁標題由下方 useEffect 依 phase 切換（liff.html 的 <title> 是三頁共用的預設值）
  if (phase === "binding" && ctx) return <BindingView ctx={ctx} />;
  if (phase === "set-password" && ctx) return <SetPasswordView ctx={ctx} liff={window.liff} />;
  return null;
}

createRoot(document.getElementById("liff-root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <LiffApp />
    </ToastProvider>
  </React.StrictMode>,
);
