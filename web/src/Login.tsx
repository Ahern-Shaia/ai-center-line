import { useState } from "react";
import { ApiError, login } from "./api";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      await login(email, pw);
      onLogin();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setErr("帳號或密碼錯誤");
      else if (e instanceof ApiError) setErr(e.message);
      else setErr("登入失敗，請稍後再試");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="mark">AI</span>
          <span className="name">aiproot 戰情室</span>
        </div>
        <div>
          <div className="login-h1">登入</div>
          <div className="login-sub">請使用您的公司帳號登入</div>
        </div>
        <div className="field">
          <label htmlFor="email">電子郵件</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required placeholder="you@company.com" />
        </div>
        <div className="field">
          <label htmlFor="pw">密碼</label>
          <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
        </div>
        {err && <div className="login-err" role="alert">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "登入中…" : "登入"}</button>
      </form>
    </div>
  );
}
