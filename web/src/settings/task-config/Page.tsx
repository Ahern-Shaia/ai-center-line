import { useCallback, useEffect, useState } from "react";
import { ApiError, getTaskConfig, updateTaskTiming, type TaskConfig } from "../../api";
import { usePermissions } from "../../permission/PermissionContext";
import { useToast } from "../../Toast";
import PageTabs from "../../shared/PageTabs";
import CategoryManagement from "../../aiproot-console/CategoryManagement";
import { useTenantPicker } from "../../shared/TenantPicker";

/**
 * 任務設定 · navigation-and-capability-gating §4
 *
 * 這頁是「每家公司對 task 的性質要求不一樣」的落點。
 *
 * 兩層模型（§1.4）：**權限由我司開放，內容是客戶自己的。**
 * 看得到這頁就代表 aiproot 開放了；看得到之後，幾天算逾時是客戶自己決定的。
 *
 * ⚠️ 沒有「要不要簽核」那一區（N-7）。它只在資料層預留，
 *    UI 不放灰掉的假按鈕 —— 客戶問「這什麼時候有」的成本比少一個區塊高。
 */
export default function TaskConfigPage() {
  // 平台角色要先選看哪一家；客戶方只有自己一家，picker 回 null
  const [tenantId, picker, ready] = useTenantPicker();
  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>任務設定</h1>
          <div className="sub">這家公司的任務長什麼樣、多久算逾時</div>
        </div>
        {picker}
      </div>
      <PageTabs ariaLabel="任務設定" tabs={[
        { key: "shape", label: "任務長什麼樣", render: () => <TaskShape tenantId={tenantId} ready={ready} /> },
        { key: "timing", label: "時間", render: () => <TaskTiming tenantId={tenantId} ready={ready} /> },
        // doc §4 把分類列為本頁的一個區塊 —— 它決定任務被分成哪幾類，
        // 跟「任務長什麼樣」是同一組決定，不該是另一個側欄項目
        { key: "category", label: "分類", perm: "categories:view", render: () => <CategoryManagement /> },
      ]} />
    </>
  );
}

/** 抽取模板 · 唯讀（OQ-NAV-10：走 task-config:template，預設不給，按客戶成熟度再開）*/
function TaskShape({ tenantId, ready }: { tenantId?: string; ready: boolean }) {
  const toast = useToast();
  const [cfg, setCfg] = useState<TaskConfig | null>(null);
  useEffect(() => {
    if (!ready) return;
    getTaskConfig(tenantId).then(setCfg).catch((err) =>
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger"));
  }, [toast, tenantId, ready]);
  return (
    <div className="sc-card">
      <div className="sc-card-hdr">
        <strong>抽取模板</strong>
        <span className="sc-status off">由 aiproot 設定</span>
      </div>
      <div className="sc-row">
        <div className="sc-row-lbl">
          目前使用
          <span className="sc-row-hint">決定 AI 從對話裡抽哪些欄位</span>
        </div>
        <div className="sc-row-val">
          {cfg?.template
            ? <><strong>{cfg.template.label}</strong><span className="sc-row-hint">{cfg.template.description}</span></>
            : <span className="sc-row-hint">載入中…</span>}
        </div>
      </div>
    </div>
  );
}

function TaskTiming({ tenantId, ready }: { tenantId?: string; ready: boolean }) {
  const perms = usePermissions();
  const toast = useToast();
  const canEditTiming = perms.has("task-config:timing");

  const [cfg, setCfg] = useState<TaskConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [grace, setGrace] = useState("");
  const [tier1, setTier1] = useState("");
  const [tier2, setTier2] = useState("");

  const refresh = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const r = await getTaskConfig(tenantId);
      setCfg(r);
      setGrace(String(r.graceDays));
      setTier1(String(r.tierDays[0]));
      setTier2(String(r.tierDays[1]));
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [toast, tenantId, ready]);

  useEffect(() => { void refresh(); }, [refresh]);

  const n = (v: string) => Number.parseInt(v, 10);
  const dirty = !!cfg && (n(grace) !== cfg.graceDays
    || n(tier1) !== cfg.tierDays[0] || n(tier2) !== cfg.tierDays[1]);
  const invalid = [grace, tier1, tier2].some((v) => !Number.isInteger(n(v)) || n(v) < 1 || n(v) > 90)
    || n(tier1) >= n(tier2);

  async function save() {
    setSaving(true);
    try {
      const r = await updateTaskTiming({ tenantId, graceDays: n(grace), tierDays: [n(tier1), n(tier2)] });
      // N-6：改動會即時重算歷史任務的「逾時 N 天」。不講的話主管會以為資料被人改過
      toast.show(
        r.affectedTickets > 0
          ? `已儲存 · 目前有 ${r.affectedTickets} 件任務落在逾時範圍`
          : "已儲存 · 目前沒有任務落在逾時範圍",
        "ok",
      );
      await refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "儲存失敗", "danger");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="sc-row-hint">載入中…</div>;

  return (
    <>
      <div className="sc-card">
        <div className="sc-card-hdr">
          <strong>時間</strong>
          {cfg?.isDefault && <span className="sc-status off">目前使用平台預設</span>}
        </div>

        <div className="sc-row">
          <div className="sc-row-lbl">
            逾時寬限期
            <span className="sc-row-hint">任務卡幾天沒簽核就標記逾時</span>
          </div>
          <div className="sc-row-val">
            <input className="tf" type="number" min={1} max={90} style={{ width: 90 }}
              value={grace} disabled={!canEditTiming}
              onChange={(e) => setGrace(e.target.value)} />
            <span className="sc-row-hint">天（1–90）</span>
          </div>
        </div>

        <div className="sc-row">
          <div className="sc-row-lbl">
            提醒升級階梯
            <span className="sc-row-hint">同一句話講 30 天，人會自動忽略 · 所以提醒要分級</span>
          </div>
          <div className="sc-row-val">
            <input className="tf" type="number" min={1} max={90} style={{ width: 78 }}
              value={tier1} disabled={!canEditTiming}
              onChange={(e) => setTier1(e.target.value)} />
            <span className="sc-row-hint">天內只提一次</span>
            <input className="tf" type="number" min={1} max={90} style={{ width: 78 }}
              value={tier2} disabled={!canEditTiming}
              onChange={(e) => setTier2(e.target.value)} />
            <span className="sc-row-hint">天內附上天數 · 超過就不再對當事人重複，改浮到主管端</span>
          </div>
        </div>

        {canEditTiming && (
          <div className="sc-card-foot">
            <button className="btn btn-primary" disabled={!dirty || invalid || saving} onClick={save}>
              {saving ? "儲存中…" : "儲存"}
            </button>
          </div>
        )}
        {invalid && (
          <div className="sc-row-hint" style={{ textAlign: "right" }}>
            天數需為 1–90 的整數，且第一段要小於第二段
          </div>
        )}
      </div>
    </>
  );
}
