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
  type LlmConfigMasked,
  type LlmProviderName,
  ApiError,
} from "../api";
import { useToast } from "../Toast";

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<LlmConfigMasked | null>(null);
  const [providerModels, setProviderModels] = useState<Record<LlmProviderName, string[]>>({
    anthropic: [], openai: [], google: [], ollama: [], deepseek: [],
  });

  const [provider, setProvider] = useState<LlmProviderName>("anthropic");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const providerCfg = PROVIDER_BY_NAME[provider];

  const fetchConfig = useCallback(async () => {
    try {
      const res = await getLlmConfig();
      setProviderModels(res.providerModels);
      if (res.config) {
        setCurrent(res.config);
        setProvider(res.config.provider);
        setModel(res.config.model);
        setBaseUrl(res.config.baseUrl ?? "");
      } else {
        setModel(res.providerModels.anthropic[0] ?? "");
      }
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  useEffect(() => {
    const models = providerModels[provider];
    if (models?.length > 0 && !models.includes(model)) setModel(models[0]);
  }, [provider, providerModels, model]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (providerCfg.needsKey && !apiKey.trim()) {
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
        provider,
        model: model.trim(),
        apiKey: apiKey.trim() || "not-required",
        baseUrl: baseUrl.trim() || undefined,
      });
      toast.show("設定已儲存 · 下次分析採用新設定", "ok");
      setApiKey("");
      await fetchConfig();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "儲存失敗", "danger");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="pane pane-center"><div className="llm-page" style={{ padding: 40, textAlign: "center", color: "var(--ink-3)" }}>載入中…</div></div>;
  }

  return (
    <div className="pane pane-center">
      <div className="llm-page">
      <h1>語言模型設定</h1>
      <p style={{ color: "var(--ink-3)", marginTop: 4, marginBottom: 20, fontSize: 13 }}>
        設定 AI 對話分析使用的模型 · 支援 5 家供應商。API 金鑰以 AES-256 加密後存入資料庫 · 僅分析時解密 · 介面僅顯示遮罩內容。
      </p>

      {current && (
        <div className="llm-current-chip">
          <span className="dot" />
          目前
          <b>{PROVIDER_BY_NAME[current.provider]?.label ?? current.provider}</b>
          <code>{current.model}</code>
          金鑰
          <code>{current.apiKeyMasked}</code>
          · 更新於 {new Date(current.updatedAt).toLocaleString("zh-TW", { hour12: false })}
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
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "儲存中…" : "儲存設定"}
          </button>
          {current && <span className="llm-hint">下次上傳的對話分析採用新設定 · 已完成的分析結果不受影響</span>}
        </div>
      </form>
      </div>
    </div>
  );
}
