import { useEffect, useState } from "react";
import { ApiError, liffGetPrefill, liffCompleteBinding, type LiffPrefill } from "../api";
import type { LiffCtx } from "./types";

// LIFF 綁定視圖（React 版 · 取代 binding.html 綁定流程）
export default function BindingView({ ctx }: { ctx: LiffCtx }) {
  const [data, setData] = useState<LiffPrefill | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ displayName: string; departmentName: string | null; departmentSource: string } | null>(null);

  useEffect(() => {
    liffGetPrefill(ctx.botId, ctx.lineUserId)
      .then(setData)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "讀取失敗"))
      .finally(() => setLoading(false));
  }, [ctx.botId, ctx.lineUserId]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const displayName = data?.prefill?.displayName || ctx.displayName || "（未知）";
      const res = await liffCompleteBinding({
        botId: ctx.botId,
        accessToken: ctx.accessToken,
        displayName,
        metadata: { lineDisplayName: ctx.displayName, candidateGroupsCount: data?.prefill?.candidateGroups.length ?? 0 },
      });
      setDone(res);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "綁定失敗");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="liff-wrap"><div className="dm-empty">載入中…</div></div>;

  if (done) {
    const dept = done.departmentName ? `「${done.departmentName}」部門`
      : done.departmentSource === "unassigned_needs_manager" ? "（待主管指派部門）" : "";
    return (
      <div className="liff-wrap liff-center">
        <div className="liff-ok-mark">✓</div>
        <h2 className="liff-h">綁定成功</h2>
        <p className="liff-sub"><b>{done.displayName}</b>{dept && ` · ${dept}`}</p>
        <p className="liff-hint">之後隨時傳「日報」二字給 bot，就能查看今天 AI 整理的工作日報。</p>
      </div>
    );
  }

  if (data?.status === "already_bound") {
    return (
      <div className="liff-wrap liff-center">
        <h2 className="liff-h">已完成綁定</h2>
        <p className="liff-sub">綁定為 <b>{data.existing?.userDisplayName}</b></p>
        <p className="liff-hint">傳「日報」給 bot 即可查看今日工作整理。</p>
      </div>
    );
  }

  const groups = data?.prefill?.candidateGroups ?? [];
  const total = groups.reduce((s, g) => s + g.messageCount, 0) || 1;
  const primaryDept = groups[0]?.departmentName;
  const name = data?.prefill?.displayName || ctx.displayName || "（未知）";

  return (
    <div className="liff-wrap">
      <h2 className="liff-h">完成綁定</h2>
      <p className="liff-sub">確認以下身分即可開始使用個人日報</p>

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
            <div className="liff-groups-hd">你常出現的工作群</div>
            {groups.map((g, i) => (
              <div key={g.groupId} className={`liff-group${i === 0 ? " primary" : ""}`}>
                <span>{g.displayName || g.groupId.slice(0, 12)}</span>
                <span className="liff-pct">{Math.round((g.messageCount / total) * 100)}%</span>
              </div>
            ))}
            <div className="liff-hint" style={{ marginTop: 10 }}>
              {primaryDept ? <>→ 綁定後你歸屬「<b>{primaryDept}</b>」部門</> : "→ 此群尚未分派部門 · 綁定後主管會幫你調整"}
            </div>
          </>
        ) : (
          <div className="liff-hint" style={{ textAlign: "center", padding: "8px 0" }}>
            尚未在任何工作群發過訊息 · 綁定後主管會在後台幫你分派部門
          </div>
        )}
      </div>

      {err && <div className="login-err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      <button className="btn btn-primary" style={{ width: "100%", marginTop: 14, padding: 13 }} onClick={() => void confirm()} disabled={busy}>
        {busy ? "綁定中…" : "確認綁定"}
      </button>
    </div>
  );
}
