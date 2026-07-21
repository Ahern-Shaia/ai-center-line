import { useState } from "react";
import { onboardTenant, ApiError, type OnboardResult } from "../api";
import { useToast } from "../Toast";

// aiproot 側 · 一鍵開通新客戶精靈 · 3 步（scope 簡化 · OQ-TP-9 用 default 6 部門）
type Step = 1 | 2 | 3 | 4;

const DEFAULT_DEPTS = ["人資總務", "售後服務", "報工生產", "技術工程", "技術研發", "業務一部"];

export default function OnboardWizard() {
  const toast = useToast();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);

  const [tenantName, setTenantName] = useState("");
  const [industry, setIndustry] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminEmailConfirm, setAdminEmailConfirm] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [depts, setDepts] = useState<string[]>(DEFAULT_DEPTS);

  const [result, setResult] = useState<OnboardResult | null>(null);
  const [copied, setCopied] = useState(false);

  const canNext1 = tenantName.trim().length > 0 && adminEmail.trim().length > 3 && adminEmail === adminEmailConfirm;
  const canNext2 = depts.length > 0 && depts.every((d) => d.trim().length > 0);

  async function handleSubmit() {
    setSaving(true);
    try {
      const res = await onboardTenant({
        tenantName: tenantName.trim(),
        industry: industry.trim() || undefined,
        adminEmail: adminEmail.trim(),
        adminDisplayName: adminDisplayName.trim() || undefined,
        departments: depts.map((d) => d.trim()),
      });
      setResult(res);
      setStep(4);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "開通失敗", "danger");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setStep(1); setTenantName(""); setIndustry("");
    setAdminEmail(""); setAdminEmailConfirm(""); setAdminDisplayName("");
    setDepts(DEFAULT_DEPTS); setResult(null); setCopied(false);
  }

  return (
    <div className="pane onboard-wrap">
      <div className="pane-hdr">
        <div>
          <h1>開通新租戶</h1>
          <div className="sub">建立新客戶 · 首個 tenant_admin 帳號 · 預塞 default 部門 · 一次完成</div>
        </div>
      </div>

      <div className="wizard-steps">
        <StepBadge n={1} label="客戶資訊" active={step === 1} done={step > 1} />
        <StepBadge n={2} label="部門模板" active={step === 2} done={step > 2} />
        <StepBadge n={3} label="確認送出" active={step === 3} done={step > 3} />
        <StepBadge n={4} label="完成" active={step === 4} done={false} />
      </div>

      {step === 1 && (
        <div className="wizard-body">
          <h2>Step 1 · 客戶資訊</h2>
          <div className="field">
            <label>公司名稱 *</label>
            <input type="text" value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="例：測試客戶B" />
          </div>
          <div className="field">
            <label>產業別（選填）</label>
            <input type="text" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="例：製造業 / 食品加工 / 醫療" />
          </div>
          <div className="field">
            <label>首個管理員 Email *</label>
            <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="例：admin@company.com.tw" />
          </div>
          <div className="field">
            <label>再次確認 Email *</label>
            <input type="email" value={adminEmailConfirm} onChange={(e) => setAdminEmailConfirm(e.target.value)} placeholder="再輸入一次 · 避免打錯" />
            {adminEmail && adminEmailConfirm && adminEmail !== adminEmailConfirm && (
              <div className="llm-hint" style={{ color: "var(--cat-maint)" }}>兩次輸入不一致</div>
            )}
          </div>
          <div className="field">
            <label>管理員顯示名（選填）</label>
            <input type="text" value={adminDisplayName} onChange={(e) => setAdminDisplayName(e.target.value)} placeholder="例：王總 / 李董 / 陳經理" />
          </div>
          <div className="llm-form-actions">
            <button className="btn btn-primary" onClick={() => setStep(2)} disabled={!canNext1}>下一步</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-body">
          <h2>Step 2 · 部門模板</h2>
          <p className="wizard-note">預設 6 個工廠通用部門 · 可增減。開通後也能在「部門/成員」頁改。</p>
          <div className="onboard-depts">
            {depts.map((d, i) => (
              <div key={i} className="onboard-dept-row">
                <input type="text" value={d} onChange={(e) => setDepts((s) => s.map((x, j) => j === i ? e.target.value : x))} placeholder="部門名" />
                <button className="btn btn-sm btn-ghost" onClick={() => setDepts((s) => s.filter((_, j) => j !== i))}>移除</button>
              </div>
            ))}
            <button className="btn btn-sm btn-ghost" onClick={() => setDepts((s) => [...s, ""])}>+ 加一個部門</button>
          </div>
          <div className="llm-form-actions">
            <button className="btn btn-ghost" onClick={() => setStep(1)}>上一步</button>
            <button className="btn btn-primary" onClick={() => setStep(3)} disabled={!canNext2}>下一步</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="wizard-body">
          <h2>Step 3 · 確認送出</h2>
          <div className="onboard-summary">
            <div><span>公司名稱</span><b>{tenantName}</b></div>
            <div><span>產業別</span><b>{industry || "—"}</b></div>
            <div><span>管理員 Email</span><b>{adminEmail}</b></div>
            <div><span>管理員顯示名</span><b>{adminDisplayName || "—"}</b></div>
            <div><span>部門數</span><b>{depts.length}</b></div>
            <div><span>部門清單</span><b>{depts.join(" · ")}</b></div>
          </div>
          <div className="llm-tip">
            <strong>執行時會做的事</strong>
            <ul>
              <li>建立 tenant 記錄 · onboard_status 標「測試中」</li>
              <li>建立管理員帳號 · 系統產強隨機 16 字元密碼 · bcrypt 加密</li>
              <li>建立上述 {depts.length} 個部門</li>
              <li>初始密碼 <strong>只在下一頁顯示一次</strong> · 請立即記錄並安全傳達給客戶</li>
              <li>客戶首次登入時強制改密碼 · 無法用初始密碼久待</li>
            </ul>
          </div>
          <div className="llm-form-actions">
            <button className="btn btn-ghost" onClick={() => setStep(2)} disabled={saving}>上一步</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? "建立中…" : "確認 · 開通租戶"}
            </button>
          </div>
        </div>
      )}

      {step === 4 && result && (
        <div className="wizard-body">
          <h2>Step 4 · 開通完成 ✓</h2>
          <div className="onboard-success">
            <div className="onboard-success-row">
              <div className="lbl">租戶 ID</div>
              <div className="val mono">{result.tenantId}</div>
            </div>
            <div className="onboard-success-row">
              <div className="lbl">管理員 Email</div>
              <div className="val mono">{result.adminEmail}</div>
            </div>
            <div className="onboard-success-password">
              <div className="lbl">初始密碼</div>
              <div className="val mono onboard-pw">{result.initialPassword}</div>
              <button
                className="btn btn-primary"
                onClick={() => { navigator.clipboard.writeText(result.initialPassword); setCopied(true); }}
              >
                {copied ? "已複製 ✓" : "複製密碼"}
              </button>
            </div>
            <div className="onboard-warn">
              <strong>⚠️ 密碼只在此頁顯示一次</strong>
              <p>離開此頁後將無法再看到此密碼。請立刻透過帶外通道（電話 / Signal / 當面）傳給客戶，並提醒客戶首次登入時系統會強制改密碼。</p>
            </div>
          </div>
          <div className="llm-form-actions">
            <button className="btn btn-primary" onClick={reset} disabled={!copied}>
              {copied ? "完成 · 開通新一家" : "請先複製密碼"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepBadge({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`wizard-step${active ? " active" : ""}${done ? " done" : ""}`}>
      <span className="wizard-step-n">{done ? "✓" : n}</span>
      <span className="wizard-step-lbl">{label}</span>
    </div>
  );
}
