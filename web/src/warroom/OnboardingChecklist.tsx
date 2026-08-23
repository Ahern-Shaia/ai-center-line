import { useEffect, useState } from "react";
import { getOnboardingProgress, type OnboardingStep } from "../api";

// 導入進度 · 「空狀態當老師」②
//
// ⭐ 為什麼是 checklist 而不是導覽 tour：**tour 看完就忘，checklist 會一直在，直到做完。**
// 四項都完成就整個消失 —— 一張永遠消不掉的清單會變成版面上的噪音。
//
// 失敗就整個不顯示（不擋主畫面、不跳錯誤）：這是輔助資訊，
// 它掛掉不該讓總覽儀表看起來像壞了。

export default function OnboardingChecklist({ tenantId }: { tenantId?: string }) {
  const [steps, setSteps] = useState<OnboardingStep[] | null>(null);

  useEffect(() => {
    let alive = true;
    getOnboardingProgress(tenantId)
      .then((r) => { if (alive) setSteps(r.allDone ? [] : r.steps); })
      .catch(() => { if (alive) setSteps([]); });
    return () => { alive = false; };
  }, [tenantId]);

  if (!steps || steps.length === 0) return null;
  const doneCount = steps.filter((s) => s.complete).length;

  return (
    <section className="obp-card">
      <div className="obp-hdr">
        <span className="obp-title">導入進度</span>
        <span className="obp-count">{doneCount} / {steps.length} 完成</span>
      </div>
      <ol className="obp-list">
        {steps.map((s) => (
          <li className={`obp-item${s.complete ? " is-done" : ""}`} key={s.key}>
            <span className="obp-mark" aria-hidden>{s.complete ? "✓" : ""}</span>
            <span className="obp-body">
              <span className="obp-label">
                {s.label}
                {/* 有分母就顯示「做到哪／總共」——「12 / 56」比「未完成」有用得多 */}
                {s.total !== null && <b className="obp-num">{s.done} / {s.total}</b>}
                {s.total === null && s.done > 0 && <b className="obp-num">{s.done}</b>}
              </span>
              {!s.complete && <span className="obp-hint">{s.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
