import { useCallback, useEffect, useState } from "react";
import {
  ApiError, getCompletionStats, getUnresolvedSignals, listAiprootTenants,
  type CompletionStats, type UnresolvedSignal,
} from "../api";
import { useToast } from "../Toast";
import StyledSelect from "../shared/StyledSelect";

// 任務完成追蹤的成效與未接住清單 · docs/modules/task-completion-tracking.md §8
//
// ⚠️ 這一頁是**平台管理員的除錯與校準工具**，不是客戶的待辦。
//
// ⭐ 先看接住率，再看結案率。
// 若收到 20 則完成回覆卻只對上 3 張任務 —— 問題在**我們的鏈**不在人，
// 那時候去催同仁按按鈕是完全搞錯方向（doc M7）。

export default function CompletionTracking() {
  const [tenants, setTenants] = useState<Array<{ tenantId: string; tenantName: string }>>([]);
  const [tenantId, setTenantId] = useState("");
  const [stats, setStats] = useState<CompletionStats | null>(null);
  const [signals, setSignals] = useState<UnresolvedSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    void listAiprootTenants()
      .then((r) => {
        const list = r.tenants.map((t) => ({ tenantId: t.tenantId, tenantName: t.tenantName }));
        setTenants(list);
        if (list[0]) setTenantId(list[0].tenantId);
      })
      .catch((e) => toast.show(e instanceof ApiError ? e.message : "讀取租戶失敗", "danger"));
  }, [toast]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [s, u] = await Promise.all([
        getCompletionStats(tenantId),
        getUnresolvedSignals(tenantId),
      ]);
      setStats(s);
      setSignals(u.items);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "讀取失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toast]);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>任務完成追蹤</h1>
          <div className="sub">
            先看接住率再看結案率 —— 接不住代表鏈斷了，不是同仁不配合
          </div>
        </div>
        <div className="row" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <StyledSelect
            value={tenantId}
            onChange={setTenantId}
            items={tenants.map((t) => ({ id: t.tenantId, label: t.tenantName }))}
            ariaLabel="選擇客戶"
            width={200}
          />
          <button className="btn" onClick={() => void load()} disabled={loading}>重新整理</button>
        </div>
      </div>

      {loading && !stats && <div className="dm-empty">載入中…</div>}

      {stats && (
        <>
          <section className="cost-section">
            <div className="cost-section-hdr"><h2 className="cost-section-title">訊號接住率（近 {stats.windowDays} 天）</h2></div>
            <div className="wt-stat">
              <Stat
                v={stats.signals.catchRate === null ? "—" : `${stats.signals.catchRate}%`}
                l="接住率"
                tone={rateTone(stats.signals.catchRate)}
              />
              <Stat v={String(stats.signals.total)} l="收到的引用回覆（筆）" />
              <Stat v={String(stats.signals.completion)} l="其中帶完成語意（筆）" />
              <Stat v={String(stats.signals.caught)} l="成功對上任務（筆）" />
              {/* 「對上任務」與「真的把任務關掉」是兩件事 —— 進度回報也算對上，
                  但任務還開著。混成一個數字會讓人以為結案量比實際高。 */}
              <Stat v={String(stats.signals.closedByReply)} l="其中真的關掉任務（筆）" />
              <Stat
                v={String(stats.signals.materializationGap)}
                l="對不上 · 原訊息不是任務（筆）"
                tone={stats.signals.materializationGap > 0 ? "warn" : undefined}
              />
              <Stat v={String(stats.signals.awaitingBatch)} l="等下一輪分析（筆）" />
              {stats.signals.ticketGone > 0 && (
                <Stat
                  v={String(stats.signals.ticketGone)}
                  l="掛到的任務已被刪除（筆）"
                  tone="warn"
                />
              )}
            </div>
            <p className="wt-formula">
              接住率的分母<b>不含</b>「等下一輪分析」的 —— 那些只是批次還沒輪到，不是漏接。
              只有「原訊息不是任務」才是材料化漏接，才可以拿去校準門檻。
            </p>
          </section>

          <section className="cost-section">
            <div className="cost-section-hdr"><h2 className="cost-section-title">任務結案（近 {stats.windowDays} 天）</h2></div>
            <div className="wt-stat">
              <Stat
                v={stats.tickets.closeRate === null ? "—" : `${stats.tickets.closeRate}%`}
                l="結案率"
                tone={rateTone(stats.tickets.closeRate)}
              />
              <Stat v={String(stats.tickets.done)} l="已完成（件）" />
              <Stat v={String(stats.tickets.otherClosed)} l="其他結束（件）" />
              <Stat v={String(stats.tickets.dropped)} l="不用做了（件）" />
              <Stat v={String(stats.tickets.open)} l="尚未確認完成（件）" />
            </div>
            {/* 公式攤開來寫 —— 競品主打「達成率即時更新」卻全站不說怎麼算，
                結果是客戶無法驗證，數字最後不被信任 */}
            <p className="wt-formula">{stats.tickets.formula}</p>
          </section>
        </>
      )}

      <section className="cost-section">
        <div className="cost-section-hdr"><h2 className="cost-section-title">未接住清單（{signals.length} 筆）</h2></div>
        <p className="sub" style={{ marginTop: 0 }}>
          收到了引用回覆但對不上任務。兩種成因的解法相反 ——
          「等下一輪分析」等就好；「原訊息不是任務」才要回頭看材料化門檻。
        </p>
        {signals.length === 0
          ? <div className="dm-empty">目前沒有未接住的訊號</div>
          : (
            <table className="dm-table">
              <thead>
                <tr>
                  <th style={{ width: "14%" }}>時間</th>
                  <th style={{ width: "12%" }}>群組</th>
                  <th style={{ width: "10%" }}>回覆者</th>
                  <th style={{ width: "28%" }}>回覆內容</th>
                  <th style={{ width: "22%" }}>被引用的原訊息</th>
                  <th style={{ width: "14%" }}>原因</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => (
                  <tr key={s.signalId}>
                    <td className="wt-mono">{fmtTime(s.receivedAt)}</td>
                    <td>{s.groupName ?? "—"}</td>
                    <td>{s.replier ?? "—"}</td>
                    <td>{s.note ?? "—"}</td>
                    <td className="wt-soft">{s.quotedText ?? "（找不到原訊息）"}</td>
                    <td>
                      <span className={`wt-sig-reason ${s.reason === "materialization_gap" ? "gap" : "wait"}`}>
                        {s.reasonLabel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
    </>
  );
}

function Stat({ v, l, tone }: { v: string; l: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "var(--ok, #059669)" : tone === "warn" ? "var(--warn)" : undefined;
  return (
    <div>
      <div className="wt-stat-v" style={color ? { color } : undefined}>{v}</div>
      <div className="wt-stat-l">{l}</div>
    </div>
  );
}

function rateTone(rate: number | null): "ok" | "warn" | undefined {
  if (rate === null) return undefined;
  return rate >= 60 ? "ok" : "warn";
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-TW", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
