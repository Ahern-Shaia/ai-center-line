import { useState, type ReactNode } from "react";
import { usePermissions } from "../permission/PermissionContext";

export interface PageTab {
  key: string;
  label: string;
  /** 沒有這個權限就連 tab 都不顯示（OQ-NAV-6：各 tab 權限分開，成本比抽取健康度敏感）*/
  perm?: string;
  render: () => ReactNode;
}

/**
 * 合併頁的分頁列。
 *
 * ⚠️ **只 render 當前 tab**（N-4）。四頁各自要打 API，一次全掛上去等於
 * 進頁面就發四個請求、卡在最慢的那個 —— 合併的本意是少點幾次，不是變慢。
 *
 * ⚠️ 沒有權限的 tab 不顯示，而不是顯示後點下去 403。
 * 「看得到卻點不動」比看不到更難查（2026-07-29 總覽儀表 403 的教訓）。
 */
export default function PageTabs({ tabs, ariaLabel }: { tabs: PageTab[]; ariaLabel: string }) {
  const perms = usePermissions();
  const visible = tabs.filter((t) => !t.perm || perms.has(t.perm));
  const [active, setActive] = useState(visible[0]?.key ?? "");

  if (visible.length === 0) {
    return <div className="dm-empty">你的角色無權查看此頁 · 請聯繫管理員</div>;
  }

  const current = visible.find((t) => t.key === active) ?? visible[0];

  return (
    <>
      <div className="wr-tabs" role="tablist" aria-label={ariaLabel}>
        {visible.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={current.key === t.key}
            className={`wr-tab${current.key === t.key ? " active" : ""}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {current.render()}
    </>
  );
}
