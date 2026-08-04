import Spinner from "../../shared/Spinner";
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
import { useTenantPicker } from "../../shared/TenantPicker";

// scheduler-config M4 · 定時任務設定
// 對照 docs/modules/scheduler-config.md §4 · v0.2 APPROVED
export default function SchedulerConfigPage() {
  const session = getSession();
  const perms = usePermissions();
  const toast = useToast();
  const canView = perms.has("scheduler-config:view");
  const canManageTenant = perms.has("scheduler-config:manage-tenant");
  const canManagePlatform = perms.has("scheduler-config:manage-platform");

  // 平台角色要能指定「在設哪一家」。沒有這個，aiproot 存檔一律變成 platform default
  // （session.tenantId 是 null），於是新租戶永遠沒有自己的排程 —— 群組收得到訊息但不會被分析。
  const [pickedTenantId, tenantPicker, tenantReady] = useTenantPicker();

  const [configs, setConfigs] = useState<SchedulerConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState<SchedulerConfigRow | null>(null);

  const refresh = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    if (!tenantReady) return;                 // 平台角色等租戶清單載回來再查，否則會拿到空 tenantId
    setLoading(true);
    try {
      const res = await listSchedulerConfigs(pickedTenantId);
      setConfigs(res.configs);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [canView, toast, pickedTenantId, tenantReady]);

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

  /**
   * 這家還沒有任何設定時的起始值。
   *
   * 沒有它的話頁面會走進死路：`activeCfg` 回 null → 不渲染任何卡片 →
   * 空狀態叫人「聯繫 AIPROOT 技術支援」，而 aiproot 自己就是技術支援。
   * 新接的租戶因此永遠沒有排程，群組收得到訊息卻不會被分析。
   *
   * 預設值取自台灣福祉實際在跑的設定（已驗證可用），一律先停用 ——
   * 開不開由人決定，不要幫客戶自動啟動會花 API 費用的東西。
   */
  const draftCfg = useCallback((id: SchedulerId): SchedulerConfigRow => ({
    schedulerId: id,
    tenantId: pickedTenantId ?? session?.tenantId ?? null,
    enabled: false,
    cronExpr: "0 18 * * *",
    timeZone: "Asia/Taipei",
    minSourceCount: id === "pdr" ? 2 : 0,
    lookbackDays: id === "pdr" ? 1 : 2,
    concurrency: 3,
    lastRunAt: null,
    nextRunAt: null,
    lastRunResult: null,
    updatedBy: null,
    updatedAt: "",
  }), [pickedTenantId, session?.tenantId]);

  async function doSave(patch: Partial<SchedulerConfigRow> & { schedulerId: SchedulerId }) {
    if (!canManageTenant && !canManagePlatform) return;
    setBusy(true);
    try {
      const active = activeCfg(patch.schedulerId) ?? draftCfg(patch.schedulerId);
      await upsertSchedulerConfig({
        schedulerId: patch.schedulerId,
        // 平台角色寫到「目前選的租戶」；只有明確指定 null 才動平台預設。
        // 舊寫法一律取 session.tenantId，而平台帳號沒有租戶 → 永遠只能寫平台預設。
        tenantId: canManagePlatform
          ? (patch.tenantId === null ? null : (pickedTenantId ?? null))
          : (session?.tenantId ?? null),
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
              ? "平台預設設定 · 可調整整體預設值與各公司的個別設定"
              : "貴公司的排程設定 · 未調整時採用系統預設值（部分進階項目由 AIPROOT 維護）"}
          </div>
        </div>
      </div>

      {tenantPicker && <div className="dm-tenant-picker">{tenantPicker}</div>}

      {loading && <Spinner block />}

      {!loading && configs.length === 0 && !canManagePlatform && (
        <div className="dm-empty">尚未建立排程 · 請聯繫 AIPROOT 技術支援</div>
      )}

      {!loading && (["pdr", "group_batch"] as SchedulerId[]).map((sid) => {
        // 沒有現成設定時給一份草稿（停用中），讓這家可以從零建立 ——
        // 否則平台端會看到「請聯繫技術支援」，而自己就是技術支援
        const existing = activeCfg(sid);
        const active = existing ?? (canManagePlatform ? draftCfg(sid) : null);
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
            isDraft={!existing}
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
  title, schedulerId, cfg, isOverride, isDraft,
  canManageTenant, canManagePlatform, busy,
  onToggle, onSave,
}: {
  title: string;
  schedulerId: SchedulerId;
  cfg: SchedulerConfigRow;
  isOverride: boolean;
  /** 這家還沒有任何設定 · 畫面上的值只是草稿，按儲存才會真的建立 */
  isDraft: boolean;
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
  // 「每天 HH:MM」型 → 給時間選擇器；其他（每週/每月…）→ 只走進階 cron
  const dailyTime = useMemo(() => timeFromCron(cronExpr), [cronExpr]);
  const [showAdvanced, setShowAdvanced] = useState(dailyTime === null);
  const nextRun = cfg.nextRunAt ? new Date(cfg.nextRunAt) : null;

  const lastRun = cfg.lastRunAt ? new Date(cfg.lastRunAt) : null;
  const lastResult = cfg.lastRunResult as { status?: string; errorMessage?: string } | null;

  return (
    <div className="sc-card">
      <div className="sc-card-hdr">
        <div>
          <h2 style={{ margin: 0, fontSize: 15 }}>{title}</h2>
          <div className="sub" style={{ marginTop: 3 }}>
            {isDraft ? "這家尚未建立排程 · 以下為建議值，儲存後才生效" : (isOverride ? "已自訂" : "採用系統預設值")}
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
          執行時間
          <span className="sc-row-hint">每天固定時間執行</span>
        </div>
        <div className="sc-row-val">
          {dailyTime !== null ? (
            <input
              className="tf"
              type="time"
              value={dailyTime}
              onChange={(e) => { if (e.target.value) setCronExpr(cronFromTime(e.target.value)); }}
              disabled={busy || !canEditBasic}
              style={{ width: 130 }}
            />
          ) : (
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>使用進階排程（見下方）</span>
          )}
          <span className="sc-code-tz">{cfg.timeZone}</span>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>· {cronHuman}</span>
        </div>
      </div>

      <div className="sc-row">
        <div className="sc-row-lbl">下次執行</div>
        <div className="sc-row-val">
          {isDirty ? (
            <span style={{ fontSize: 12.5, color: "var(--warn)" }}>設定尚未儲存 · 儲存後重算</span>
          ) : nextRun ? (
            <span style={{ fontSize: 13 }}>
              {formatNextRun(nextRun)}
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>（{nextRun.toLocaleString("zh-TW", { hour12: false })}）</span>
            </span>
          ) : (
            <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{cfg.enabled ? "—" : "已停用 · 不會自動執行"}</span>
          )}
        </div>
      </div>

      <div className="sc-row">
        <div className="sc-row-lbl">
          <button className="nc-lnk mut" style={{ padding: 0 }} onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "▾" : "▸"} 進階排程設定
          </button>
          <span className="sc-row-hint">非「每天固定時間」才需要</span>
        </div>
        <div className="sc-row-val">
          {showAdvanced ? (
            <>
              <input
                className="tf"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                disabled={busy || !canEditBasic}
                style={{ width: 160, fontFamily: "var(--mono, ui-monospace, monospace)" }}
              />
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Cron 表達式 · e.g. 30 17 * * * ＝每天 17:30</span>
            </>
          ) : (
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>目前：<code>{cronExpr}</code></span>
          )}
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
            失敗補跑天數
            <span className="sc-row-hint">前一次執行失敗時，往前補跑幾天的資料{canEditCost ? "" : "（進階設定 · 由 AIPROOT 調整）"}</span>
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
          <span className="sc-row-hint">同時處理幾個群組 · 設太高可能超出 AI 服務限制{canEditCost ? "" : "（進階設定 · 由 AIPROOT 調整）"}</span>
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

/** cron → "HH:MM"（僅「每天固定時間」型）· 其他型別回 null，改走進階 cron */
function timeFromCron(expr: string): string | null {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [min, hr, dom, mon, dow] = p;
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;
  if (!/^\d{1,2}$/.test(min) || !/^\d{1,2}$/.test(hr)) return null;
  const h = Number(hr), m = Number(min);
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" → 每天該時間的 cron */
function cronFromTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${m} ${h} * * *`;
}

/** 下次執行的口語說明（今天 / 明天 / 日期）*/
function formatNextRun(d: Date): string {
  const hhmm = d.toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => x.toLocaleDateString("en-CA");
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  if (day(d) === day(now)) return `今天 ${hhmm} `;
  if (day(d) === day(tomorrow)) return `明天 ${hhmm} `;
  return `${d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })} ${hhmm} `;
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
