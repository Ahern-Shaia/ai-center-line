import { useEffect, useState } from "react";
import { ApiError, getMapConfig, setMapConfig, setMapTileConfig } from "../api";
import { useToast } from "../Toast";
import StyledSelect from "../shared/StyledSelect";

const PROVIDERS = [
  { id: "openrouteservice", label: "OpenRouteService（免綁卡 · 免費）" },
  { id: "google_routes", label: "Google Routes（精度最佳 · 需綁卡帳號）" },
];
const TILE_PROVIDERS = [
  { id: "osm", label: "標準地圖（CARTO light · 免金鑰）" },
  { id: "maptiler", label: "MapTiler（需金鑰 · 量大更穩）" },
];

// aiproot 全域地圖設定（外勤里程用）· routing 算里程 + tile 畫地圖 · key 加密存 DB
export default function MapConfig() {
  const toast = useToast();
  const [provider, setProvider] = useState("openrouteservice");
  const [hasKey, setHasKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [tileProvider, setTileProvider] = useState("osm");
  const [hasTileKey, setHasTileKey] = useState(false);
  const [tileApiKey, setTileApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tileBusy, setTileBusy] = useState(false);

  useEffect(() => {
    getMapConfig()
      .then((c) => {
        setProvider(c.provider); setHasKey(c.hasKey);
        setTileProvider(c.tileProvider); setHasTileKey(c.hasTileKey);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const c = await setMapConfig({ provider, apiKey: apiKey.trim() || undefined });
      setHasKey(c.hasKey); setApiKey("");
      toast.show("已儲存里程 provider 設定", "ok");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "儲存失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function saveTile() {
    if (tileBusy) return;
    setTileBusy(true);
    try {
      const c = await setMapTileConfig({ tileProvider, tileApiKey: tileApiKey.trim() || undefined });
      setHasTileKey(c.hasTileKey); setTileApiKey("");
      toast.show("已儲存地圖圖磚設定", "ok");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "儲存失敗", "danger");
    } finally {
      setTileBusy(false);
    }
  }

  return (
    <div className="pane">
      <div className="pane-hdr"><div>
        <h1>地圖里程設定</h1>
        <div className="sub">里程 provider 算 A→B 路線里程 · 圖磚 provider 畫「我的行程」地圖 · key 加密儲存 · 僅平台端可設</div>
      </div></div>

      {loading ? (
        <div className="dm-empty">載入中…</div>
      ) : (
        <div style={{ maxWidth: 520 }}>
          <h2 style={{ fontSize: 14, marginBottom: 8, color: "var(--ink-3)" }}>里程計算 provider</h2>
          <div className="field">
            <label>provider</label>
            <StyledSelect ariaLabel="里程計算服務" items={PROVIDERS} value={provider} onChange={setProvider} />
          </div>
          <div className="field">
            <label>
              API Key
              {hasKey && <span style={{ color: "var(--ok-600)", fontSize: 12, marginLeft: 6 }}>· 已設定（留空＝不變更）</span>}
            </label>
            <input className="tf" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasKey ? "••••••（留空保留現有）" : "貼上 API key"} autoComplete="off" />
          </div>
          <div className="login-hint" style={{ marginTop: 4 }}>
            <b>OpenRouteService</b>：到 openrouteservice.org 免費申請（免綁信用卡）。<br />
            <b>Google Routes</b>：Google Cloud 啟用 Routes API、建立 API key（需綁卡帳號）。<br />
            沒設 key 也能打卡，只是里程先留空白、之後可補算。
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => void save()} disabled={busy}>
            {busy ? "儲存中…" : "儲存 provider"}
          </button>

          <h2 style={{ fontSize: 14, marginTop: 32, marginBottom: 8, color: "var(--ink-3)" }}>地圖圖磚（畫「我的行程」地圖）</h2>
          <div className="field">
            <label>圖磚 provider</label>
            <StyledSelect ariaLabel="地圖圖磚服務" items={TILE_PROVIDERS} value={tileProvider} onChange={setTileProvider} />
          </div>
          {tileProvider === "maptiler" && (
            <div className="field">
              <label>
                MapTiler 金鑰
                {hasTileKey && <span style={{ color: "var(--ok-600)", fontSize: 12, marginLeft: 6 }}>· 已設定（留空＝不變更）</span>}
              </label>
              <input className="tf" type="password" value={tileApiKey} onChange={(e) => setTileApiKey(e.target.value)}
                placeholder={hasTileKey ? "••••••（留空保留現有）" : "貼上 MapTiler key"} autoComplete="off" />
            </div>
          )}
          <div className="login-hint" style={{ marginTop: 4 }}>
            <b>標準地圖</b>：CARTO light 底圖（OpenStreetMap 資料），免金鑰、與「客戶地圖」一致。<br />
            <b>MapTiler</b>：到 maptiler.com 申請免費金鑰，量大時較穩定。
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => void saveTile()} disabled={tileBusy}>
            {tileBusy ? "儲存中…" : "儲存圖磚設定"}
          </button>
        </div>
      )}
    </div>
  );
}
