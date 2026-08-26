import { useCallback, useEffect, useState } from "react";
import { ApiError, getTaskConfig, updateTaskTiming, type TaskConfig } from "../../api";
import { usePermissions } from "../../permission/PermissionContext";
import { useToast } from "../../Toast";
import PageTabs from "../../shared/PageTabs";
import CategoryManagement from "../../aiproot-console/CategoryManagement";
import { useTenantPicker } from "../../shared/TenantPicker";
import { useT } from "../../i18n/useT";

/**
 * 任務設定 · navigation-and-capability-gating §4
 *
 * 這頁是「每家公司對 task 的性質要求不一樣」的落點。
 *
 * 兩層模型（§1.4）：**權限由我司開放，內容是客戶自己的。**
 * 看得到這頁就代表 aiproot 開放了；看得到之後，幾天算逾時是客戶自己決定的。
 *
 * ⚠️ 沒有「要不要核對」那一區（N-7）。它只在資料層預留，
 *    UI 不放灰掉的假按鈕 —— 客戶問「這什麼時候有」的成本比少一個區塊高。
 */
export default function TaskConfigPage() {
  const tr = useT();
  // 平台角色要先選看哪一家；客戶方只有自己一家，picker 回 null
  const [tenantId, picker, ready] = useTenantPicker();
  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>{tr("nav.taskConfig")}</h1>
          <div className="sub">{tr("tc.sub")}</div>
        </div>
        {picker}
      </div>
      <PageTabs ariaLabel={tr("nav.taskConfig")} tabs={[
        { key: "shape", label: tr("tc.tabShape"), render: () => <TaskShape tenantId={tenantId} ready={ready} /> },
        { key: "timing", label: tr("tc.tabTiming"), render: () => <TaskTiming tenantId={tenantId} ready={ready} /> },
        // doc §4 把分類列為本頁的一個區塊 —— 它決定任務被分成哪幾類，
        // 跟「任務長什麼樣」是同一組決定，不該是另一個側欄項目
        { key: "category", label: tr("kb.fldCategory"), perm: "categories:view", render: () => <CategoryManagement /> },
      ]} />
    </>
  );
}

/** 抽取模板 · 唯讀（OQ-NAV-10：走 task-config:template，預設不給，按客戶成熟度再開）*/
function TaskShape({ tenantId, ready }: { tenantId?: string; ready: boolean }) {
  const tr = useT();
  const toast = useToast();
  const [cfg, setCfg] = useState<TaskConfig | null>(null);
  useEffect(() => {
    if (!ready) return;
    getTaskConfig(tenantId).then(setCfg).catch((err) =>
      toast.show(err instanceof ApiError ? err.message : tr("common.loadFailed"), "danger"));
  }, [toast, tenantId, ready]);
  return (
    <div className="sc-card">
      <div className="sc-card-hdr">
        <strong>{tr("tc.template")}</strong>
        <span className="sc-status off">{tr("tc.byAiproot")}</span>
      </div>
      <div className="sc-row">
        <div className="sc-row-lbl">
          {tr("tc.inUse")}
          <span className="sc-row-hint">{tr("tc.templateHint")}</span>
        </div>
        <div className="sc-row-val">
          {cfg?.template
            ? <><strong>{cfg.template.label}</strong><span className="sc-row-hint">{cfg.template.description}</span></>
            : <span className="sc-row-hint">{tr("common.loading")}</span>}
        </div>
      </div>
    </div>
  );
}

function TaskTiming({ tenantId, ready }: { tenantId?: string; ready: boolean }) {
  const tr = useT();
  const perms = usePermissions();
  const toast = useToast();
  const canEditTiming = perms.has("task-config:timing");

  const [cfg, setCfg] = useState<TaskConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [grace, setGrace] = useState("");
  const [tier1, setTier1] = useState("");
  const [tier2, setTier2] = useState("");
  const [assignNotify, setAssignNotify] = useState(true);

  const refresh = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const r = await getTaskConfig(tenantId);
      setCfg(r);
      setGrace(String(r.graceDays));
      setTier1(String(r.tierDays[0]));
      setTier2(String(r.tierDays[1]));
      setAssignNotify(r.assignNotify);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("common.loadFailed"), "danger");
    } finally {
      setLoading(false);
    }
  }, [toast, tenantId, ready]);

  useEffect(() => { void refresh(); }, [refresh]);

  const n = (v: string) => Number.parseInt(v, 10);
  const dirty = !!cfg && (n(grace) !== cfg.graceDays
    || n(tier1) !== cfg.tierDays[0] || n(tier2) !== cfg.tierDays[1]
    || assignNotify !== cfg.assignNotify);
  const invalid = [grace, tier1, tier2].some((v) => !Number.isInteger(n(v)) || n(v) < 1 || n(v) > 90)
    || n(tier1) >= n(tier2);

  async function save() {
    setSaving(true);
    try {
      const r = await updateTaskTiming({ tenantId, graceDays: n(grace), tierDays: [n(tier1), n(tier2)], assignNotify });
      // N-6：改動會即時重算歷史任務的「逾時 N 天」。不講的話主管會以為資料被人改過
      toast.show(
        r.affectedTickets > 0
          ? tr("tc.savedN", { n: r.affectedTickets })
          : tr("tc.saved0"),
        "ok",
      );
      await refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("common.saveFailed"), "danger");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="sc-row-hint">{tr("common.loading")}</div>;

  return (
    <>
      <div className="sc-card">
        <div className="sc-card-hdr">
          <strong>{tr("tc.tabTiming")}</strong>
          {cfg?.isDefault && <span className="sc-status off">{tr("tc.usingDefault")}</span>}
        </div>

        <div className="sc-row">
          <div className="sc-row-lbl">
            {tr("tc.grace")}
            <span className="sc-row-hint">{tr("tc.graceHint")}</span>
          </div>
          <div className="sc-row-val">
            <input className="tf" type="number" min={1} max={90} style={{ width: 90 }}
              value={grace} disabled={!canEditTiming}
              onChange={(e) => setGrace(e.target.value)} />
            <span className="sc-row-hint">{tr("tc.days190")}</span>
          </div>
        </div>

        <div className="sc-row">
          <div className="sc-row-lbl">
            {tr("tc.ladder")}
            <span className="sc-row-hint">{tr("tc.ladderHint")}</span>
          </div>
          <div className="sc-row-val">
            <input className="tf" type="number" min={1} max={90} style={{ width: 78 }}
              value={tier1} disabled={!canEditTiming}
              onChange={(e) => setTier1(e.target.value)} />
            <span className="sc-row-hint">{tr("tc.stage1")}</span>
            <input className="tf" type="number" min={1} max={90} style={{ width: 78 }}
              value={tier2} disabled={!canEditTiming}
              onChange={(e) => setTier2(e.target.value)} />
            <span className="sc-row-hint">{tr("tc.stage2")}</span>
          </div>
        </div>

        <div className="sc-row">
          <div className="sc-row-lbl">
            {tr("tc.notifyAssignee")}
            <span className="sc-row-hint">{tr("tc.notifyHint")}</span>
          </div>
          <div className="sc-row-val">
            <label style={{ cursor: canEditTiming ? "pointer" : "default" }}>
              <input type="checkbox" checked={assignNotify} disabled={!canEditTiming}
                onChange={(e) => setAssignNotify(e.target.checked)} />{" "}
              <span style={{ fontSize: 12, color: assignNotify ? "var(--ok, #059669)" : "var(--ink-3)" }}>
                {assignNotify ? tr("common.on") : tr("common.off")}
              </span>
            </label>
            {/* 只私訊當事人一個人，群組看不到 —— 這件事要講，否則主管會怕打擾全群 */}
            <span className="sc-row-hint">{tr("tc.notifyDmOnly")}</span>
          </div>
        </div>

        {canEditTiming && (
          <div className="sc-card-foot">
            <button className="btn btn-primary" disabled={!dirty || invalid || saving} onClick={save}>
              {saving ? tr("common.saving") : tr("tc.save")}
            </button>
          </div>
        )}
        {invalid && (
          <div className="sc-row-hint" style={{ textAlign: "right" }}>
            {tr("tc.invalid")}
          </div>
        )}
      </div>
    </>
  );
}
