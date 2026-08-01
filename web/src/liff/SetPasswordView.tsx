import Spinner from "../shared/Spinner";
import { useEffect, useState } from "react";
import { ApiError, liffGetPrefill, liffSetPassword } from "../api";
import type { LiffCtx, LiffSdk } from "./types";

// LIFF 設密碼視圖（Option C · React 版 · 取代 binding.html 設密碼流程）
export default function SetPasswordView({ ctx, liff }: { ctx: LiffCtx; liff: LiffSdk }) {
  const [loading, setLoading] = useState(true);
  const [notBound, setNotBound] = useState(false);
  const [boundName, setBoundName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okEmail, setOkEmail] = useState("");

  useEffect(() => {
    liffGetPrefill(ctx.botId, ctx.lineUserId)
      .then((d) => {
        if (d.status !== "already_bound") setNotBound(true);
        else setBoundName(d.existing?.userDisplayName ?? "");
      })
      .catch(() => setNotBound(true))
      .finally(() => setLoading(false));
  }, [ctx.botId, ctx.lineUserId]);

  async function save() {
    if (busy) return;
    setErr("");
    const e = email.trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setErr("email 格式錯");
    if (!pw) return setErr("請輸入密碼");
    if (pw !== pw2) return setErr("兩次密碼不一致");
    setBusy(true);
    try {
      await liffSetPassword({ botId: ctx.botId, accessToken: ctx.accessToken, email: e, password: pw });
      setOkEmail(e);
      setTimeout(() => { try { liff.closeWindow(); } catch { /* 外部瀏覽器無法關 */ } }, 1500);
    } catch (err) {
      setErr(err instanceof ApiError ? err.message : "設定失敗");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="liff-wrap"><Spinner block /></div>;
  if (notBound) return (
    <div className="liff-wrap liff-center">
      <h2 className="liff-h">尚未完成綁定</h2>
      <p className="liff-hint">請先完成 LINE 綁定，才能設定登入密碼。</p>
    </div>
  );
  if (okEmail) return (
    <div className="liff-wrap liff-center">
      <div className="liff-ok-mark">✓</div>
      <h2 className="liff-h">密碼已設定</h2>
      <p className="liff-sub">之後可用 <b>{okEmail}</b> 登入 aiproot 網頁</p>
    </div>
  );

  return (
    <div className="liff-wrap">
      <h2 className="liff-h">設定登入密碼</h2>
      <p className="liff-sub">{boundName && <>{boundName} · </>}設定後可用 email + 密碼登入網頁（選配，不設也可用「以 LINE 登入」）</p>

      <div className="field"><label htmlFor="sp-email">電子郵件</label>
        <input id="sp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" /></div>
      <div className="field"><label htmlFor="sp-pw">密碼</label>
        <input id="sp-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
      <div className="field"><label htmlFor="sp-pw2">再次輸入密碼</label>
        <input id="sp-pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></div>

      {err && <div className="login-err" role="alert">{err}</div>}
      <button className="btn btn-primary" style={{ width: "100%", marginTop: 8, padding: 13 }} onClick={() => void save()} disabled={busy}>
        {busy ? "儲存中…" : "儲存密碼"}
      </button>
    </div>
  );
}
