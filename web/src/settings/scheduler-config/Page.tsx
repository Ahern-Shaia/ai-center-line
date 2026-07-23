import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getSession,
  listSchedulerConfigs,
  upsertSchedulerConfig,
  type SchedulerConfigRow,
  type SchedulerId,
} from "../../api";
import { usePermissions } from "../../permission/PermissionContext";
import { useToast } from "../../Toast";
import ConfirmDialog from "../../shared/ConfirmDialog";

// scheduler-config M4 · 定時任務設定
// 對照 docs/modules/scheduler-config.md §4 · v0.2 APPROVED
export default function SchedulerConfigPage() {
  const session = getSession();
  const perms = usePermissions();
  const toast = useToast();
  const canView = perms.has("scheduler-config:view");
  const canManageTenant = perms.has("scheduler-config:manage-tenant");
  const canManagePlatform = perms.has("scheduler-config:manage-platform");

  const [configs, setConfigs] = useState<SchedulerConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState<SchedulerConfigRow | null>(null);

  const refresh = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await listSchedulerConfigs();
      setConfigs(res.configs);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [canView, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  // 依 scheduler_id 分組 · 每組拿 tenant override (若有) 或 platform default
  const resolved = useMemo(() => {
    const byId = new Map<SchedulerId, { override: SchedulerConfigRow | null; platform: SchedulerConfigRow | null }>();
    for (const cfg of configs) {
      const entry = byId.get(cfg.schedulerId) ?? { override: null, platform: null };
      if (cfg.tenantId === null) entry.platform = cfg;
      else entry.override = cfg;
      byId.set(cfg.schedulerId, entry);
    }
    return byId;
  }, [configs]);

  const activeCfg = useCallback((id: SchedulerId): SchedulerConfigRow | null => {
    const entry = resolved.get(id);
    return entry?.override ?? entry?.platform ?? null;
  }, [resolved]);

  async function doSave(patch: Partial<SchedulerConfigRow> & { schedulerId: SchedulerId }) {
    if (!canManageTenant && !canManagePlatform) return;
    setBusy(true);
    try {
      const active = activeCfg(patch.schedulerId);
      if (!active) return;
      await upsertSchedulerConfig({
        schedulerId: patch.schedulerId,
        tenantId: canManagePlatform && patch.tenantId === null ? null : (session?.tenantId ?? null),
        enabled: patch.enabled ?? active.enabled,
        cronExpr: patch.cronExpr ?? active.cronExpr,
        timeZone: patch.timeZone ?? active.timeZone,
        minSourceCount: patch.minSourceCount ?? active.minSourceCount,
        lookbackDays: patch.lookbackDays ?? active.lookbackDays,
        concurrency: patch.concurrency ?? active.concurrency,
      });
      toast.show("已儲存 · SchedulerManager 已重排下次觸發時間", "ok");
      await refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "儲存失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  function handleToggle(id: SchedulerId, next: boolean) {
    const active = activeCfg(id);
    if (!active) return;
    if (!next) {
      // 停用 · OQ-SCH-6 A · 二次 confirm
      setConfirmDisable(active);
      return;
    }
    void doSave({ schedulerId: id, enabled: true });
  }

  if (!canView) {
    return (
      <div className="pane">
        <div className="pane-hdr"><div><h1>定時任務設定</h1></div></div>
        <div className="dm-empty">你的角色無權查看此頁 · 請聯繫管理員</div>
      </div>
    );
  }

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>定時任務設定</h1>
          <div className="sub">
            {canManagePlatform
              ? "aiproot 全站設定 · 可改 platform default + 各 tenant override"
              : "本 tenant 設定 · 未 override 時走 platform default（成本欄位僅 aiproot 可改）"}
          </div>
        </div>
      </div>

      {loading && <div className="dm-empty">載入中…</div>}

      {!loading && configs.length === 0 && (
        <div className="dm-empty">尚無設定 · 請聯繫 aiproot 建立 default</div>
      )}

      {!loading && (["pdr", "group_batch"] as SchedulerId[]).map((sid) => {
        const active = activeCfg(sid);
        if (!active) return null;
        const isOverride = resolved.get(sid)?.override !== null && resolved.get(sid)?.override !== undefined;
        const title = sid === "pdr" ? "個人日報 · 每日整理" : "群組日誌 · 每日整理";
        return (
          <SchedulerCard
            key={sid}
            title={title}
            schedulerId={sid}
            cfg={active}
            isOverride={isOverride}
            canManageTenant={canManageTenant}
            canManagePlatform={canManagePlatform}
            busy={busy}
            onToggle={(next) => handleToggle(sid, next)}
            onSave={(patch) => void doSave({ schedulerId: sid, ...patch })}
          />
        );
      })}

      <ConfirmDialog
        open={confirmDisable !== null}
        onClose={() => !busy && setConfirmDisable(null)}
        onConfirm={() => {
          if (confirmDisable) {
            void doSave({ schedulerId: confirmDisable.schedulerId, enabled: false });
            setConfirmDisable(null);
          }
        }}
        busy={busy}
        title="停用定時任務"
        body={
          <div>
            即將停用「<b>{confirmDisable?.schedulerId === "pdr" ? "個人日報" : "群組日誌"}</b>」的每日自動整理
            <div style={{ marginTop: 10, padding: 10, background: "var(--warn-tint)", border: "1px solid #F5D5A6", borderRadius: 6, fontSize: 12, color: "#7A4E1B" }}>
              停用後：
              <ul style={{ marginLeft: 18, marginTop: 4 }}>
                <li>系統不會自動每天在指定時間跑</li>
                <li>下游主管 LINE 通知會斷</li>
                <li>員工仍可從「我的日報」/「立即分析」手動觸發</li>
              </ul>
            </div>
          </div>
        }
        confirmLabel="確定停用"
        tone="danger"
      />
    </div>
  );
}

function SchedulerCard({
  title, schedulerId, cfg, isOverride,
  canManageTenant, canManagePlatform, busy,
  onToggle, onSave,
}: {
  title: string;
  schedulerId: SchedulerId;
  cfg: SchedulerConfigRow;
  isOverride: boolean;
  canManageTenant: boolean;
  canManagePlatform: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
  onSave: (patch: Partial<SchedulerConfigRow>) => void;
}) {
  const [cronExpr, setCronExpr] = useState(cfg.cronExpr);
  const [minSourceCount, setMinSourceCount] = useState(cfg.minSourceCount);
  const [lookbackDays, setLookbackDays] = useState(cfg.lookbackDays);
  const [concurrency, setConcurrency] = useState(cfg.concurrency);

  useEffect(() => {
    setCronExpr(cfg.cronExpr);
    setMinSourceCount(cfg.minSourceCount);
    setLookbackDays(cfg.lookbackDays);
    setConcurrency(cfg.concurrency);
  }, [cfg.cronExpr, cfg.minSourceCount, cfg.lookbackDays, cfg.concurrency]);

  const canEditBasic = canManageTenant || canManagePlatform;
  const canEditCost = canManagePlatform;
  const isDirty = cronExpr !== cfg.cronExpr
    || minSourceCount !== cfg.minSourceCount
    || (canEditCost && (lookbackDays !== cfg.lookbackDays || concurrency !== cfg.concurrency));

  // Cron 到人類可讀 (簡易)
  const cronHuman = useMemo(() => humanCron(cronExpr), [cronExpr]);

  const lastRun = cfg.lastRunAt ? new Date(cfg.lastRunAt) : null;
  const lastResult = cfg.lastRunResult as { status?: string; errorMessage?: string } | null;

  return (
    <div className="sc-card">
      <div className="sc-card-hdr">
        <div>
          <h2 style={{ margin: 0, fontSize: 15 }}>{title}</h2>
          <div className="sub" style={{ marginTop: 3 }}>
            {isOverride ? "本 tenant 已 override" : "使用 platform default"}
            {" · "}scheduler_id = <code>{schedulerId}</code>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={`sc-status ${cfg.enabled ? "on" : "off"}`}>
            {cfg.enabled ? "啟用中" : "停用"}
          </span>
          {canEditBasic && (
            <button
              className="btn"
              onClick={() => onToggle(!cfg.enabled)}
              disabled={busy}
            >{cfg.enabled ? "停用" : "啟用"}</button>
          )}
        </div>
      </div>

      <div className="sc-row">
        <div className="sc-row-lbl">
          Cron 表達式
          <span className="sc-row-hint">e.g. "30 17 * * *" = 每天 17:30</span>
        </div>
        <div className="sc-row-val">
          <input
            className="tf"
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
            disabled={busy || !canEditBasic}
            style={{ width: 160, fontFamily: "var(--mono, ui-monospace, monospace)" }}
          />
          <span className="sc-code-tz">{cfg.timeZone}</span>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>· {cronHuman}</span>
        </div>
      </div>

      <div className="sc-row">
        <div className="sc-row-lbl">
          跳過門檻
          <span className="sc-row-hint">訊息數少於 N 不觸發 AI (成本控管)</span>
        </div>
        <div className="sc-row-val">
          當日私訊 &lt;
          <input
            className="tf"
            type="number"
            value={minSourceCount}
            onChange={(e) => setMinSourceCount(Number(e.target.value))}
            disabled={busy || !canEditBasic}
            style={{ width: 60 }}
          />
          則時跳過
        </div>
      </div>

      {schedulerId === "group_batch" && (
        <div className="sc-row">
          <div className="sc-row-lbl">
            Lookback 保底
            <span className="sc-row-hint">前次執行失敗 · 補跑往前 N 天 batches {canEditCost ? "" : "(aiproot 專用)"}</span>
          </div>
          <div className="sc-row-val">
            <input
              className="tf"
              type="number"
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Number(e.target.value))}
              disabled={busy || !canEditCost}
              style={{ width: 60 }}
            /> 天
          </div>
        </div>
      )}

      <div className="sc-row">
        <div className="sc-row-lbl">
          併發限制
          <span className="sc-row-hint">同時跑幾個 batch · 過高會爆 AI API {canEditCost ? "" : "(aiproot 專用)"}</span>
        </div>
        <div className="sc-row-val">
          <input
            className="tf"
            type="number"
            value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            disabled={busy || !canEditCost}
            style={{ width: 60 }}
          /> 個
        </div>
      </div>

      <div className="sc-row">
        <div className="sc-row-lbl">上次執行</div>
        <div className="sc-row-val">
          {lastRun ? (
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {lastRun.toLocaleString("zh-TW", { hour12: false })}
              {" · "}
              <span style={{ color: lastResult?.status === "completed" ? "var(--ok, #059669)" : "var(--warn)" }}>
                {lastResult?.status ?? "unknown"}
              </span>
              {lastResult?.errorMessage && (
                <div style={{ marginTop: 3, color: "var(--danger, #DC2626)" }}>{lastResult.errorMessage}</div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>尚未執行</div>
          )}
        </div>
      </div>

      {canEditBasic && (
        <div className="sc-card-foot">
          <button
            className="btn btn-primary"
            disabled={busy || !isDirty}
            onClick={() => onSave({ cronExpr, minSourceCount, lookbackDays, concurrency })}
          >儲存變更</button>
        </div>
      )}
    </div>
  );
}

function humanCron(expr: string): string {
  // 簡易 · 只解析「HH:MM 每天」pattern
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return "自訂 · 每次觸發時算";
  const [min, hr, dom, mon, dow] = parts;
  if (dom === "*" && mon === "*" && dow === "*" && /^\d+$/.test(min) && /^\d+$/.test(hr)) {
    return `每天 ${hr.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  return "自訂 · 每次觸發時算";
}
