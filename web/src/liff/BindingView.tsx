import Spinner from "../shared/Spinner";
import { useEffect, useState } from "react";
import { ApiError, liffGetPrefill, liffCompleteBinding, type LiffPrefill } from "../api";
import type { LiffCtx } from "./types";
import { useT } from "../i18n/useT";

// LIFF 綁定視圖（React 版 · 取代 binding.html 綁定流程）
export default function BindingView({ ctx }: { ctx: LiffCtx }) {
  const tr = useT();
  const [data, setData] = useState<LiffPrefill | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ displayName: string; departmentName: string | null; departmentSource: string } | null>(null);

  useEffect(() => {
    liffGetPrefill(ctx.botId, ctx.lineUserId)
      .then(setData)
      .catch((e) => setErr(e instanceof ApiError ? e.message : tr("liff.loadFailed")))
      .finally(() => setLoading(false));
  }, [ctx.botId, ctx.lineUserId]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const displayName = data?.prefill?.displayName || ctx.displayName || tr("common.unknown");
      const res = await liffCompleteBinding({
        botId: ctx.botId,
        accessToken: ctx.accessToken,
        displayName,
        metadata: { lineDisplayName: ctx.displayName, candidateGroupsCount: data?.prefill?.candidateGroups.length ?? 0 },
      });
      setDone(res);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tr("liff.bindFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="liff-wrap"><Spinner block /></div>;

  if (done) {
    const dept = done.departmentName ? tr("liff.deptNamed", { dept: done.departmentName })
      : done.departmentSource === "unassigned_needs_manager" ? tr("liff.deptPending") : "";
    return (
      <div className="liff-wrap liff-center">
        <div className="liff-ok-mark">✓</div>
        <h2 className="liff-h">{tr("liff.bindOk")}</h2>
        <p className="liff-sub"><b>{done.displayName}</b>{dept && ` · ${dept}`}</p>
        <p className="liff-hint">{tr("liff.bindOkHint")}</p>
      </div>
    );
  }

  if (data?.status === "already_bound") {
    return (
      <div className="liff-wrap liff-center">
        <h2 className="liff-h">{tr("liff.alreadyBound")}</h2>
        <p className="liff-sub">{tr("liff.boundAs")} <b>{data.existing?.userDisplayName}</b></p>
        <p className="liff-hint">{tr("liff.alreadyBoundHint")}</p>
      </div>
    );
  }

  const groups = data?.prefill?.candidateGroups ?? [];
  const total = groups.reduce((s, g) => s + g.messageCount, 0) || 1;
  const primaryDept = groups[0]?.departmentName;
  const name = data?.prefill?.displayName || ctx.displayName || tr("common.unknown");

  return (
    <div className="liff-wrap">
      <h2 className="liff-h">{tr("liff.finishBinding")}</h2>
      <p className="liff-sub">{tr("liff.confirmIdentity")}</p>

      <div className="liff-card">
        <div className="liff-id-row">
          <span className="liff-avatar">{ctx.pictureUrl ? <img src={ctx.pictureUrl} alt="" /> : (name[0] || "?")}</span>
          <div>
            <div className="liff-id-name">{name}</div>
            <div className="liff-id-uid">LINE UserId · {ctx.lineUserId.slice(-8)}</div>
          </div>
        </div>

        {groups.length > 0 ? (
          <>
            <div className="liff-groups-hd">{tr("liff.yourGroups")}</div>
            {groups.map((g, i) => (
              <div key={g.groupId} className={`liff-group${i === 0 ? " primary" : ""}`}>
                <span>{g.displayName || g.groupId.slice(0, 12)}</span>
                <span className="liff-pct">{Math.round((g.messageCount / total) * 100)}%</span>
              </div>
            ))}
            <div className="liff-hint" style={{ marginTop: 10 }}>
              {primaryDept ? <>{tr("liff.willJoinA")}<b>{primaryDept}</b>{tr("liff.willJoinB")}</> : tr("liff.groupNoDept")}
            </div>
          </>
        ) : (
          <div className="liff-hint" style={{ textAlign: "center", padding: "8px 0" }}>
            {tr("liff.noGroupYet")}
          </div>
        )}
      </div>

      {err && <div className="login-err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      <button className="btn btn-primary" style={{ width: "100%", marginTop: 14, padding: 13 }} onClick={() => void confirm()} disabled={busy}>
        {busy ? tr("liff.binding") : tr("liff.confirmBind")}
      </button>
    </div>
  );
}
