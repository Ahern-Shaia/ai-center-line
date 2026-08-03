import { useEffect, useState } from "react";
import { ApiError, login, getLineOauthUrl, completeLineOauth, selectLineTenant, type TenantChoice } from "./api";

const ROLE_LABEL: Record<string, string> = {
  aiproot_admin: "平台管理員", consultant: "顧問", tenant_admin: "總經理室",
  group_owner: "部門主管", assistant: "助理", employee: "員工",
};

// LINE OAuth state 由後端簽章並驗證（見 line-oauth.service）。
// 早期版本存在 sessionStorage 前端自驗 → 手機上 LINE 內建瀏覽器把導回交給 Safari 時，
// 兩者儲存空間不同、state 讀不到，員工會卡在「state 不符」完全登不進去。

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lineBusy, setLineBusy] = useState(false);
  // 一人多租戶 · 需選組織（B）
  const [tenantChoice, setTenantChoice] = useState<TenantChoice | null>(null);

  // 處理 LINE OAuth callback · URL 帶 ?code=&state=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (!code) return;
    setLineBusy(true);
    completeLineOauth(code, state ?? undefined)
      .then((choice) => {
        window.history.replaceState({}, "", window.location.pathname);
        if (choice) setTenantChoice(choice);   // 多綁 → 顯示選單，先不登入
        else onLogin();
      })
      .catch((e) => {
        setErr(e instanceof ApiError ? e.message : "LINE 登入失敗");
        window.history.replaceState({}, "", window.location.pathname);
      })
      .finally(() => setLineBusy(false));
  }, [onLogin]);

  async function pickTenant(tenantId: string | null) {
    if (!tenantChoice || !tenantId || lineBusy) return;
    setLineBusy(true);
    setErr("");
    try {
      await selectLineTenant(tenantChoice.selectionToken, tenantId);
      onLogin();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "選擇組織失敗 · 請重新以 LINE 登入");
      setTenantChoice(null);
    } finally {
      setLineBusy(false);
    }
  }

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
      else setErr("登入失敗 · 請稍後再試");
    } finally {
      setBusy(false);
    }
  }

  async function loginWithLine() {
    if (lineBusy) return;
    setLineBusy(true);
    setErr("");
    try {
      const { url } = await getLineOauthUrl();
      // state 已編在 url 裡、由後端驗簽 · 前端不再存（跨瀏覽器交接會遺失）
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "無法產生 LINE 登入連結 · 請確認 aiproot 端已配置");
      setLineBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <span className="mark">AI</span>
          <span className="name">aiproot 戰情室</span>
        </div>
        {tenantChoice ? (
          <div>
            <div className="login-h1">選擇組織</div>
            <div className="login-sub">你的 LINE 帳號在多個組織有帳號 · 請選擇要登入哪一個</div>
            {err && <div className="login-err" role="alert" style={{ marginTop: 10 }}>{err}</div>}
            <div className="tenant-pick">
              {tenantChoice.options.map((o) => (
                <button
                  key={`${o.tenantId}-${o.role}`}
                  type="button"
                  className="tenant-pick-item"
                  onClick={() => void pickTenant(o.tenantId)}
                  disabled={lineBusy}
                >
                  <span className="tp-name">{o.tenantName ?? "（未命名組織）"}</span>
                  <span className="tp-role">{ROLE_LABEL[o.role] ?? o.role}</span>
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => { setTenantChoice(null); setErr(""); }} disabled={lineBusy}>
              取消
            </button>
          </div>
        ) : (
        <>
        <div>
          <div className="login-h1">登入</div>
          <div className="login-sub">主管級請用公司帳號 · 員工可直接用 LINE 登入</div>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">電子郵件</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="you@company.com" />
          </div>
          <div className="field">
            <label htmlFor="pw">密碼</label>
            <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </div>
          {err && <div className="login-err" role="alert">{err}</div>}
          <button type="submit" className="btn btn-primary" disabled={busy || lineBusy || !email || !pw}>
            {busy ? "登入中…" : "登入"}
          </button>
        </form>

        <div className="login-divider"><span>或</span></div>

        <button
          type="button"
          className="btn line-login-btn"
          onClick={() => void loginWithLine()}
          disabled={busy || lineBusy}
          aria-label="以 LINE 登入"
        >
          <span className="line-login-icon" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 100 100" fill="currentColor">
              <path d="M50 6C25.7 6 6 22 6 41.7c0 17.7 15.6 32.5 36.7 35.3 1.4.3 3.4.9 3.9 2.2.4 1.1.3 2.9.1 4.1l-.6 3.8c-.2 1.1-.9 4.4 3.9 2.4 4.8-2 25.9-15.2 35.3-26.1C91.7 55.9 94 49 94 41.7 94 22 74.3 6 50 6zm-16.3 47H26c-.5 0-1-.4-1-1V37c0-.5.4-1 1-1h2c.5 0 1 .4 1 1v13h4.7c.5 0 1 .4 1 1v2c0 .5-.5 1-1 1zm7-1c0 .5-.4 1-1 1h-2c-.5 0-1-.4-1-1V37c0-.5.4-1 1-1h2c.5 0 1 .4 1 1v15zm18 0c0 .5-.4 1-1 1h-2c-.1 0-.2 0-.3-.1l-6.9-9.3v9.4c0 .5-.4 1-1 1h-2c-.5 0-1-.4-1-1V37c0-.5.4-1 1-1h2c.1 0 .2 0 .3.1l6.9 9.3V37c0-.5.4-1 1-1h2c.5 0 1 .4 1 1v15zm12-13H65v3h5.7c.5 0 1 .4 1 1v2c0 .5-.4 1-1 1H65v3h5.7c.5 0 1 .4 1 1v2c0 .5-.4 1-1 1H62c-.5 0-1-.4-1-1V37c0-.5.4-1 1-1h8.7c.5 0 1 .4 1 1v2c0 .5-.5 1-1 1z"/>
            </svg>
          </span>
          <span>{lineBusy ? "處理中…" : "以 LINE 登入（員工用）"}</span>
        </button>

        <div className="login-hint">
          <b>員工</b>：先加公司 LINE Bot 好友完成綁定 · 才能用 LINE 登入<br />
          <b>主管</b>：兩者皆可 · 建議用公司帳號密碼（有 2FA 保護）
        </div>
        </>
        )}
      </div>
    </div>
  );
}
