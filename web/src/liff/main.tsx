import Spinner from "../shared/Spinner";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import MyDailyReport from "../personal-report/MyDailyReport";
import { ToastProvider } from "../Toast";
import { applyLiffToken, ApiError, updateMyLocale } from "../api";
import BindingView from "./BindingView";
import SetPasswordView from "./SetPasswordView";
import PunchView from "./PunchView";
import MyTrips from "../personal-report/MyTrips";
import type { LiffCtx } from "./types";
import { t } from "../i18n";
import { useLocale, useT } from "../i18n/useT";
import { LOCALE_NAME } from "../i18n";
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
// ⚠️ 值是 **i18n key**，渲染處（下方 useEffect）必須包 tr()。
const PHASE_TITLE: Partial<Record<Phase, string>> = {
  mine: "nav.myDailyReport",
  trips: "nav.myTrips",
  punch: "liff.punch",
  binding: "liff.binding",
  "set-password": "liff.setPassword",
};


/**
 * LIFF 專用的語言切換。
 *
 * ⚠️⚠️ 為什麼非有不可：**只用 LINE、從不登入網頁的人，這是他唯一的入口。**
 *    網頁的切換在 Login 頁與右上角 user menu —— 一個外籍現場員工要走到那裡，
 *    得先找到網址、再用 email + 密碼登入（而他可能從沒設過密碼）。
 *    那條路對他等於不存在。他也正是整個 i18n 要服務的人。
 *
 * ⚠️ 顯示的是**另一個語言的名字**（現在是中文就顯示 English），
 *    跟 Login.tsx 同一個形狀 —— 使用者看到的是「按下去會變成什麼」。
 *
 * ⚠️ 已登入（mine / punch / trips）才寫回 `users.locale`：
 *    綁定 / 設密碼那兩個 phase 還沒有 JWT，寫不了，只在本機生效。
 *    寫回失敗**不可以讓畫面切不動** —— 語言是即時的本機狀態（同 api.ts 那條註解）。
 */
function LiffLocaleToggle({ persist }: { persist: boolean }) {
  const [locale, setLocale] = useLocale();
  return (
    <button
      type="button"
      className="liff-locale"
      onClick={() => {
        const next = locale === "en" ? "zh-TW" : "en";
        setLocale(next);
        if (persist) void updateMyLocale(next).catch(() => undefined);
      }}
    >
      {/* ⚠️ 語言名稱走 LOCALE_NAME，不要在這裡硬寫 ——
          i18n/index.ts 早就有那張表，硬寫會變成第二份（而且守門測試會擋）。
          顯示的是**另一個**語言的名字：使用者看到的是「按下去會變成什麼」。 */}
      {LOCALE_NAME[locale === "en" ? "zh-TW" : "en"]}
    </button>
  );
}

function LiffApp() {
  const tr = useT();
  const [phase, setPhase] = useState<Phase>("init");
  const [ctx, setCtx] = useState<LiffCtx | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const k = PHASE_TITLE[phase];
    // ⚠️ 一定要過 tr() —— PHASE_TITLE 的值是 **i18n key** 不是文字。
    //    2026-08-28 實機踩到：LINE 的標題列直接顯示「liff.punch」給員工看。
    //    tsc 擋不住（兩邊都是 string），而且**中英文都壞**。
    //    這是 `document.title` 版本的同一個坑（memory: text-to-key-render-not-updated）。
    if (k) document.title = tr(k);
  }, [phase, tr]);

  useEffect(() => {
    (async () => {
      try {
        const liff = window.liff;
        if (!liff) { setPhase("error"); setMsg(t("liff.noSdk")); return; }

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
        if (!accessToken) { setPhase("error"); setMsg(t("liff.noToken")); return; }
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
        if (!botId) { setPhase("error"); setMsg(t("liff.noBotId")); return; }
        setCtx({ botId, lineUserId: profile.userId, displayName: profile.displayName, pictureUrl: profile.pictureUrl ?? null, accessToken });
        setPhase(page === "set-password" ? "set-password" : "binding");
      } catch (e) {
        setPhase("error"); setMsg(e instanceof Error ? e.message : t("liff.initFailed"));
      }
    })();
  }, []);

  // 已登入的三頁才寫得回 users.locale（綁定 / 設密碼 / 錯誤 phase 還沒有 JWT）
  const withToggle = (el: React.ReactNode, persist: boolean) => (
    <>
      <div className="liff-locale-bar"><LiffLocaleToggle persist={persist} /></div>
      {el}
    </>
  );

  // init 只有一個轉圈圈，不掛切換鈕（它馬上會被下一個 phase 取代）
  if (phase === "init") return <div style={CENTER}><Spinner block /></div>;
  if (phase === "error") {
    return withToggle(<div style={CENTER} className="dm-empty"><div style={{ fontWeight: 600, marginBottom: 6 }}>{tr("liff.cantOpen")}</div><div className="dm-empty-hint">{msg}</div></div>, false);
  }
  if (phase === "unbound") {
    return withToggle(<div style={CENTER} className="dm-empty"><div style={{ fontWeight: 600, marginBottom: 6 }}>{tr("liff.notBound")}</div><div className="dm-empty-hint">{tr("liff.notBoundHint")}</div></div>, false);
  }
  if (phase === "mine") return withToggle(<MyDailyReport />, true);
  if (phase === "punch") return withToggle(<PunchView />, true);
  if (phase === "trips") return withToggle(<MyTrips />, true);
  // 註：分頁標題由下方 useEffect 依 phase 切換（liff.html 的 <title> 是三頁共用的預設值）
  if (phase === "binding" && ctx) return withToggle(<BindingView ctx={ctx} />, false);
  if (phase === "set-password" && ctx) return withToggle(<SetPasswordView ctx={ctx} liff={window.liff} />, false);
  return null;
}

createRoot(document.getElementById("liff-root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <LiffApp />
    </ToastProvider>
  </React.StrictMode>,
);
