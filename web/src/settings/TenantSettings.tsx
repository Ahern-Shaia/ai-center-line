import { TENANT_SETTINGS } from "../mockdata/tenantSettings";

export default function TenantSettings() {
  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>租戶設定</h1>
          <div className="sub">健康度參數、資料保存、AI 模型分階、外部整合、隱私策略（此頁面唯讀，正式版可調整）</div>
        </div>
      </div>

      <div className="ts-list">
        {TENANT_SETTINGS.map((section) => (
          <section key={section.title} className="ts-section">
            <header className="ts-section-hdr">
              <div className="ts-section-title">{section.title}</div>
              <div className="ts-section-desc">{section.desc}</div>
            </header>
            <div className="ts-items">
              {section.items.map((it) => (
                <div key={it.key} className="ts-item">
                  <div className="ts-item-label">{it.label}</div>
                  <div className="ts-item-value">{it.value}</div>
                  {it.hint && <div className="ts-item-hint">{it.hint}</div>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
