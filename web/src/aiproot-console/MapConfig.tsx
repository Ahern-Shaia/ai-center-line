import { useEffect, useState } from "react";
import { ApiError, getMapConfig, setMapConfig } from "../api";
import { useToast } from "../Toast";
import StyledSelect from "../shared/StyledSelect";

const PROVIDERS = [
  { id: "openrouteservice", label: "OpenRouteService（免綁卡 · 免費）" },
  { id: "google_routes", label: "Google Routes（精度最佳 · 需綁卡帳號）" },
];

// aiproot 全域地圖 provider 設定（外勤里程用）· API key 加密存 DB
export default function MapConfig() {
  const toast = useToast();
  const [provider, setProvider] = useState("openrouteservice");
  const [hasKey, setHasKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMapConfig()
      .then((c) => { setProvider(c.provider); setHasKey(c.hasKey); })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const c = await setMapConfig({ provider, apiKey: apiKey.trim() || undefined });
      setHasKey(c.hasKey);
      setApiKey("");
      toast.show("已儲存地圖設定", "ok");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "儲存失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pane">
      <div className="pane-hdr"><div>
        <h1>地圖里程設定</h1>
        <div className="sub">外勤打卡的 A→B 路線里程要用哪個地圖服務 · API key 加密儲存 · 僅平台端可設</div>
      </div></div>

      {loading ? (
        <div className="dm-empty">載入中…</div>
      ) : (
        <div style={{ maxWidth: 520 }}>
          <div className="field">
            <label>地圖服務 provider</label>
            <StyledSelect ariaLabel="地圖服務" items={PROVIDERS} value={provider} onChange={setProvider} />
          </div>
          <div className="field">
            <label>
              API Key
              {hasKey && <span style={{ color: "var(--ok-600)", fontSize: 12, marginLeft: 6 }}>· 已設定（留空＝不變更）</span>}
            </label>
            <input
              className="tf"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasKey ? "••••••（留空保留現有）" : "貼上 API key"}
              autoComplete="off"
            />
          </div>
          <div className="login-hint" style={{ marginTop: 4 }}>
            <b>OpenRouteService</b>：到 openrouteservice.org 免費申請（免綁信用卡）。<br />
            <b>Google Routes</b>：Google Cloud 啟用 Routes API、建立 API key（需綁卡帳號）。<br />
            沒設 key 也能打卡，只是里程先留空白、之後可補算。
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => void save()} disabled={busy}>
            {busy ? "儲存中…" : "儲存"}
          </button>
        </div>
      )}
    </div>
  );
}
