import { useCallback, useEffect, useState } from "react";
import {
  Button as AriaButton,
  ListBox,
  ListBoxItem,
  Popover,
  Radio,
  RadioGroup,
  Select,
  SelectValue,
} from "react-aria-components";
import {
  getLlmConfig,
  putLlmConfig,
  deleteLlmConfig,
  listAiprootTenants,
  type LlmConfigMasked,
  type LlmProviderName,
  type AiprootTenantOption,
  ApiError,
} from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";

interface ProviderDef {
  name: LlmProviderName;
  mark: string;                // 2-3 char logo mark for card
  label: string;
  hint: string;                // 一句話 · card 內顯示
  needsKey: boolean;
  needsBaseUrl: boolean;       // 必填
  hasBaseUrlOptional: boolean; // 選填（自訂 endpoint）
}

const PROVIDERS: ProviderDef[] = [
  { name: "anthropic", mark: "AC", label: "Anthropic Claude", hint: "支援快取加速與深度思考",          needsKey: true,  needsBaseUrl: false, hasBaseUrlOptional: false },
  { name: "openai",    mark: "AI", label: "OpenAI GPT",       hint: "JSON 結構化輸出",                  needsKey: true,  needsBaseUrl: false, hasBaseUrlOptional: true },
  { name: "google",    mark: "GM", label: "Google Gemini",    hint: "JSON 結構化輸出",                  needsKey: true,  needsBaseUrl: false, hasBaseUrlOptional: false },
  { name: "ollama",    mark: "OL", label: "Ollama 本機",       hint: "資料不出網路 · 需先下載模型",       needsKey: false, needsBaseUrl: true,  hasBaseUrlOptional: false },
  { name: "deepseek",  mark: "DS", label: "DeepSeek",         hint: "相容 OpenAI 介面 · 低成本",         needsKey: true,  needsBaseUrl: false, hasBaseUrlOptional: true },
];

const PROVIDER_BY_NAME: Record<LlmProviderName, ProviderDef> = Object.fromEntries(
  PROVIDERS.map((p) => [p.name, p]),
) as Record<LlmProviderName, ProviderDef>;

function ModelSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      className="llm-select"
      selectedKey={value}
      onSelectionChange={(k) => onChange(String(k))}
      isDisabled={disabled}
      aria-label="模型"
    >
      <AriaButton className="llm-select-btn">
        <SelectValue className="llm-select-value">
          {({ selectedText }) => selectedText || "請選擇模型"}
        </SelectValue>
        <svg className="llm-select-chev" width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden>
          <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </AriaButton>
      <Popover className="llm-select-pop" offset={4}>
        <ListBox className="llm-select-list" items={options.map((o) => ({ id: o, name: o }))}>
          {(item) => (
            <ListBoxItem id={item.id} textValue={item.name} className="llm-select-item">
              <span>{item.name}</span>
              <svg className="llm-select-check" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="m2 7 3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}

export default function LlmSettings() {
  const toast = useToast();
  const [tenants, setTenants] = useState<AiprootTenantOption[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [current, setCurrent] = useState<LlmConfigMasked | null>(null);
  const [providerModels, setProviderModels] = useState<Record<LlmProviderName, string[]>>({
    anthropic: [], openai: [], google: [], ollama: [], deepseek: [],
  });

  const [provider, setProvider] = useState<LlmProviderName>("anthropic");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const providerCfg = PROVIDER_BY_NAME[provider];
  const selectedTenant = tenants.find((t) => t.tenantId === selectedTenantId) ?? null;

  const fetchConfig = useCallback(async (tenantId: string) => {
    if (!tenantId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await getLlmConfig(tenantId);
      setProviderModels(res.providerModels);
      if (res.config) {
        setCurrent(res.config);
        setProvider(res.config.provider);
        setModel(res.config.model);
        setBaseUrl(res.config.baseUrl ?? "");
        setApiKey("");
      } else {
        setCurrent(null);
        setProvider("anthropic");
        setModel(res.providerModels.anthropic[0] ?? "");
        setBaseUrl("");
        setApiKey("");
      }
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    listAiprootTenants().then((res) => setTenants(res.tenants)).catch(() => undefined);
  }, []);

  useEffect(() => { void fetchConfig(selectedTenantId); }, [fetchConfig, selectedTenantId]);

  useEffect(() => {
    const models = providerModels[provider];
    if (models?.length > 0 && !models.includes(model)) setModel(models[0]);
  }, [provider, providerModels, model]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTenantId) {
      toast.show("請先於上方選擇租戶", "danger");
      return;
    }
    if (providerCfg.needsKey && !apiKey.trim() && !current) {
      toast.show(`${providerCfg.label} 需要 API 金鑰`, "danger");
      return;
    }
    if (providerCfg.needsBaseUrl && !baseUrl.trim()) {
      toast.show("Ollama 需要服務位址 · 例：http://localhost:11434", "danger");
      return;
    }
    setSaving(true);
    try {
      await putLlmConfig({
        tenantId: selectedTenantId,
        provider,
        model: model.trim(),
        apiKey: apiKey.trim() || "not-required",
        baseUrl: baseUrl.trim() || undefined,
      });
      toast.show(`${selectedTenant?.tenantName ?? "租戶"} · 設定已儲存 · 下次分析採用新設定`, "ok");
      setApiKey("");
      await fetchConfig(selectedTenantId);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "儲存失敗", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!selectedTenantId) return;
    setResetting(true);
    try {
      await deleteLlmConfig(selectedTenantId);
      toast.show(`${selectedTenant?.tenantName ?? "租戶"} · 已重設為平台預設`, "ok");
      setConfirmReset(false);
      await fetchConfig(selectedTenantId);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "重設失敗", "danger");
    } finally {
      setResetting(false);
    }
  }

  // 沒選 tenant · 引導頁
  if (!selectedTenantId) {
    return (
      <div className="pane pane-center">
        <div className="llm-page">
          <h1>語言模型設定</h1>
          <p style={{ color: "var(--ink-3)", marginTop: 4, marginBottom: 24, fontSize: 13 }}>
            由 aiproot 統一管理 · 為每個租戶設定 AI 對話分析採用的語言模型。<br />
            未設定的租戶 · 自動使用平台預設 (env <code>ANTHROPIC_API_KEY</code>)。
          </p>
          <TenantPicker tenants={tenants} value={selectedTenantId} onChange={setSelectedTenantId} />
          <div className="dm-empty" style={{ marginTop: 20 }}>
            請先選擇租戶 · 才能查看 / 設定該租戶的模型配置
            <div className="dm-empty-hint">未設定的租戶會 fallback 到平台預設 · 客戶端無感</div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="pane pane-center">
        <div className="llm-page">
          <h1>語言模型設定</h1>
          <TenantPicker tenants={tenants} value={selectedTenantId} onChange={setSelectedTenantId} />
          <div className="dm-empty" style={{ marginTop: 20 }}>載入中…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="pane pane-center">
      <div className="llm-page">
      <h1>語言模型設定</h1>
      <p style={{ color: "var(--ink-3)", marginTop: 4, marginBottom: 20, fontSize: 13 }}>
        由 aiproot 統一管理 · 為 <b>{selectedTenant?.tenantName ?? "當前租戶"}</b> 設定 AI 對話分析採用的模型。API 金鑰以 AES-256 加密存 DB · 僅分析時解密。
      </p>

      <TenantPicker tenants={tenants} value={selectedTenantId} onChange={setSelectedTenantId} />

      {current ? (
        <div className="llm-current-chip" style={{ marginTop: 16 }}>
          <span className="dot" />
          目前
          <b>{PROVIDER_BY_NAME[current.provider]?.label ?? current.provider}</b>
          <code>{current.model}</code>
          金鑰
          <code>{current.apiKeyMasked}</code>
          · 更新於 {new Date(current.updatedAt).toLocaleString("zh-TW", { hour12: false })}
        </div>
      ) : (
        <div className="dm-empty" style={{ marginTop: 16 }}>
          此租戶尚未設定 · <b>使用平台預設</b>（env <code>ANTHROPIC_API_KEY</code> · Anthropic Opus 4.7）
          <div className="dm-empty-hint">如要為此租戶客製 provider / model · 於下方填表儲存</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="llm-form">
        <div className="field">
          <label>供應商</label>
          <RadioGroup
            value={provider}
            onChange={(v) => setProvider(v as LlmProviderName)}
            className="llm-provider-grid"
            aria-label="語言模型供應商"
          >
            {PROVIDERS.map((p) => (
              <Radio key={p.name} value={p.name} className="llm-card">
                <div className="llm-card-head">
                  <span className="llm-card-mark">{p.mark}</span>
                  <div className="llm-card-name">{p.label}</div>
                </div>
                <div className="llm-card-hint">{p.hint}</div>
              </Radio>
            ))}
          </RadioGroup>
        </div>

        <div className="llm-divider" />

        <div className="field">
          <label>模型</label>
          {providerModels[provider]?.length > 0 ? (
            <ModelSelect
              value={model}
              options={providerModels[provider]}
              onChange={setModel}
              disabled={saving}
            />
          ) : (
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} disabled={saving} placeholder="請輸入模型名稱" />
          )}
          <div className="llm-hint">供應商支援的模型 · 若使用自行微調的模型可手動輸入</div>
        </div>

        {providerCfg.needsKey && (
          <div className="field">
            <label>API 金鑰</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={saving}
              placeholder={current?.apiKeyMasked ? `目前 ${current.apiKeyMasked} · 若不變更請重新輸入` : "sk-..."}
              autoComplete="new-password"
            />
            <div className="llm-hint">以 AES-256 加密存入資料庫 · 介面僅顯示遮罩內容 · 明碼永不外傳</div>
          </div>
        )}

        {providerCfg.needsBaseUrl && (
          <div className="field">
            <label>服務位址（必填）</label>
            <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={saving} placeholder="http://localhost:11434" />
            <div className="llm-hint">Ollama 本機服務位址 · 需先啟動 <code>ollama serve</code> 並下載模型 <code>ollama pull {model || "<模型>"}</code></div>
          </div>
        )}

        {providerCfg.hasBaseUrlOptional && (
          <div className="field">
            <label>服務位址（選填 · 自訂端點）</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={saving}
              placeholder={provider === "deepseek" ? "預設 https://api.deepseek.com/v1" : "預設 https://api.openai.com/v1"}
            />
            <div className="llm-hint">自訂服務位址（Azure OpenAI 或代理閘道）· 留空則採預設</div>
          </div>
        )}

        <div className="llm-form-actions">
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "儲存中…" : "儲存設定"}
          </button>
          {current && (
            <button
              type="button"
              className="btn"
              onClick={() => setConfirmReset(true)}
              disabled={saving || resetting}
              title="清除此租戶的自訂設定 · 讓後端 fallback 走 env ANTHROPIC_API_KEY"
            >
              重設為平台預設
            </button>
          )}
          {current && <span className="llm-hint">下次上傳的對話分析採用新設定 · 已完成的分析結果不受影響</span>}
        </div>
      </form>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => !resetting && setConfirmReset(false)}
        onConfirm={() => void handleReset()}
        busy={resetting}
        title="重設為平台預設"
        body={<>
          即將清除 <b>{selectedTenant?.tenantName ?? "此租戶"}</b> 的 LLM 設定 · 之後分析將 fallback 到 env <code>ANTHROPIC_API_KEY</code>。<br />
          原 API 金鑰會被刪除 · 若之後需要客製 · 需重新填寫。
        </>}
        confirmLabel="重設"
      />
    </div>
  );
}

function TenantPicker({
  tenants,
  value,
  onChange,
}: {
  tenants: AiprootTenantOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>目前操作租戶</span>
      <Select
        className="llm-select"
        selectedKey={value || "__none__"}
        onSelectionChange={(k) => onChange(k === "__none__" ? "" : String(k))}
        aria-label="租戶"
      >
        <AriaButton className="llm-select-btn" style={{ minWidth: 220 }}>
          <SelectValue className="llm-select-value">
            {() => value
              ? (tenants.find((t) => t.tenantId === value)?.tenantName ?? value.slice(0, 8))
              : "選擇租戶"}
          </SelectValue>
          <svg className="llm-select-chev" width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden>
            <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </AriaButton>
        <Popover className="llm-select-pop" offset={4}>
          <ListBox
            className="llm-select-list"
            items={[{ id: "__none__", name: "— 請選擇 —" }, ...tenants.map((t) => ({
              id: t.tenantId,
              name: t.tenantName,
            }))]}
          >
            {(item) => (
              <ListBoxItem id={item.id} textValue={item.name} className="llm-select-item">
                <span>{item.name}</span>
                <svg className="llm-select-check" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="m2 7 3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </Select>
    </div>
  );
}
