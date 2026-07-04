import { useState } from "react";
import { login } from "./api";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("gm@taiwanhomecare.demo");
  const [pw, setPw] = useState("demo123");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await login(email, pw);
      onLogin();
    } catch {
      setErr("帳號或密碼錯誤");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card sheet" onSubmit={submit}>
        <span className="rc tl" /><span className="rc tr" /><span className="rc bl" /><span className="rc br" />
        <div className="login-brand">台灣福祉 · AI 戰情室</div>
        <div className="login-sub">客戶專屬後台 · Powered by AIPROOT</div>
        <label className="fld">
          <span className="fld-k">帳號</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </label>
        <label className="fld">
          <span className="fld-k">密碼</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
        </label>
        {err && <div className="login-err">{err}</div>}
        <button className="btn-primary" disabled={busy}>{busy ? "登入中…" : "登入"}</button>
        <div className="login-hint">demo：gm@taiwanhomecare.demo / demo123</div>
      </form>
    </div>
  );
}
