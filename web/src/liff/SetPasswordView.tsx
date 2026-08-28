import Spinner from "../shared/Spinner";
import { useEffect, useState } from "react";
import { ApiError, liffGetPrefill, liffSetPassword } from "../api";
import type { LiffCtx, LiffSdk } from "./types";
import { useT } from "../i18n/useT";

// LIFF 設密碼視圖（Option C · React 版 · 取代 binding.html 設密碼流程）
export default function SetPasswordView({ ctx, liff }: { ctx: LiffCtx; liff: LiffSdk }) {
  const tr = useT();
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
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setErr(tr("liff.badEmail"));
    if (!pw) return setErr(tr("liff.needPw"));
    if (pw !== pw2) return setErr(tr("cpw.mismatch"));
    setBusy(true);
    try {
      await liffSetPassword({ botId: ctx.botId, accessToken: ctx.accessToken, email: e, password: pw });
      setOkEmail(e);
      setTimeout(() => { try { liff.closeWindow(); } catch { /* 外部瀏覽器無法關 */ } }, 1500);
    } catch (err) {
      setErr(err instanceof ApiError ? err.message : tr("liff.setFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="liff-wrap"><Spinner block /></div>;
  if (notBound) return (
    <div className="liff-wrap liff-center">
      <h2 className="liff-h">{tr("liff.notBound")}</h2>
      <p className="liff-hint">{tr("liff.bindFirst")}</p>
    </div>
  );
  if (okEmail) return (
    <div className="liff-wrap liff-center">
      <div className="liff-ok-mark">✓</div>
      <h2 className="liff-h">{tr("liff.pwSet")}</h2>
      <p className="liff-sub">{tr("liff.pwSetA")}<b>{okEmail}</b>{tr("liff.pwSetB")}</p>
    </div>
  );

  return (
    <div className="liff-wrap">
      <h2 className="liff-h">{tr("liff.setPassword")}</h2>
      <p className="liff-sub">{boundName && <>{boundName} · </>}{tr("liff.setPwHint")}</p>

      <div className="field"><label htmlFor="sp-email">{tr("liff.email")}</label>
        <input id="sp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" /></div>
      <div className="field"><label htmlFor="sp-pw">{tr("liff.password")}</label>
        <input id="sp-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
      <div className="field"><label htmlFor="sp-pw2">{tr("liff.passwordAgain")}</label>
        <input id="sp-pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></div>

      {err && <div className="login-err" role="alert">{err}</div>}
      <button className="btn btn-primary" style={{ width: "100%", marginTop: 8, padding: 13 }} onClick={() => void save()} disabled={busy}>
        {busy ? tr("common.saving") : tr("liff.savePw")}
      </button>
    </div>
  );
}
