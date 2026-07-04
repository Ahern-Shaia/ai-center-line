import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "./api";

// module 導覽（P1 只 warroom + signoff 有實作，其餘標 soon）
const NAV = [
  {
    group: "戰情室",
    items: [
      { key: "warroom", label: "總覽儀表", ic: iconGauge, done: true },
      { key: "signoff", label: "每日簽核", ic: iconCheck, done: true },
    ],
  },
  {
    group: "資料 · 知識",
    items: [
      { key: "rag", label: "RAG 對話", ic: iconChat, done: false },
      { key: "media", label: "素材看板", ic: iconMedia, done: false },
      { key: "km", label: "知識庫", ic: iconBook, done: false },
      { key: "map", label: "客戶地圖", ic: iconMap, done: false },
    ],
  },
  {
    group: "設定",
    items: [
      { key: "depts", label: "部門/成員", ic: iconTeam, done: false },
      { key: "config", label: "租戶設定", ic: iconCog, done: false },
      { key: "audit", label: "稽核記錄", ic: iconShield, done: false },
    ],
  },
];

const ROLE_LABEL: Record<string, string> = {
  aiproot_admin: "AIPROOT 管理員",
  consultant: "顧問",
  tenant_admin: "總經理室",
  group_owner: "群組負責人",
};

const TENANT_NAME: Record<string, string> = {
  "77777777-0000-0000-0000-000000000001": "台灣福祉科技",
};

interface Props {
  session: Session;
  active: string;
  onNav: (key: string) => void;
  onLogout: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
  asOf?: string;
  crumb?: string;
  children: ReactNode;
}

export default function Shell({ session, active, onNav, onLogout, onRefresh, refreshing, asOf, crumb, children }: Props) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  const tenantName = TENANT_NAME[session.tenantId] ?? "租戶";
  const tenantMark = tenantName.slice(0, 1);
  const initials = session.email.slice(0, 2).toUpperCase();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sb-brand" title={tenantName}>
          <span className="sb-brand-mark" aria-hidden>{tenantMark}</span>
          <div className="sb-brand-text">
            <div className="sb-brand-name">{tenantName}</div>
            <div className="sb-brand-sub">戰情室</div>
          </div>
        </div>
        <nav className="sb-nav">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="sb-group">{g.group}</div>
              {g.items.map((it) => (
                <button
                  key={it.key}
                  className={`sb-link${active === it.key ? " active" : ""}${!it.done ? " soon" : ""}`}
                  onClick={() => it.done && onNav(it.key)}
                  disabled={!it.done}
                  aria-current={active === it.key ? "page" : undefined}
                >
                  <it.ic />
                  <span>{it.label}</span>
                  {!it.done && <span className="badge">soon</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sb-foot">
          <div>Powered by <span className="sb-foot-brand">AIPROOT</span></div>
          <div className="sb-foot-ver">v0.1 · dev</div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="crumb">
            <span className="cur">{crumb ?? "總覽"}</span>
          </div>
          <div className="topbar-spacer" />
          {asOf && (
            <span className="as-of">
              <span className="dot" />
              資料截止 {new Date(asOf).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button className={`icon-btn${refreshing ? " spin" : ""}`} onClick={onRefresh} aria-label="重新整理" title="重新整理">
            <IconRefresh />
          </button>
          <div className="user" ref={menuRef}>
            <button className="user-btn" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}>
              <span className="user-avatar">{initials}</span>
              <span className="user-meta">
                <span className="user-name">{session.email.split("@")[0]}</span>
                <span className="user-role">{ROLE_LABEL[session.role] ?? session.role}</span>
              </span>
            </button>
            {menu && (
              <div className="user-menu" role="menu">
                <div className="user-menu-hdr">
                  <div className="n">{session.email.split("@")[0]}</div>
                  <div className="e">{session.email}</div>
                  <div className="t">{ROLE_LABEL[session.role] ?? session.role} · {tenantName}</div>
                </div>
                <button role="menuitem" disabled title="尚未實作">帳號設定</button>
                <button role="menuitem" disabled title="尚未實作">切換租戶</button>
                <button role="menuitem" className="danger" onClick={onLogout}>登出</button>
              </div>
            )}
          </div>
        </div>
        <main className="pane">{children}</main>
      </div>
    </div>
  );
}

// ---- inline SVG icons（keep bundle small；stroke 1.5 for observability weight）
function iconGauge() { return svg(<><path d="M3 12a9 9 0 0 1 18 0" /><path d="M12 12l4-3" /></>); }
function iconCheck() { return svg(<><path d="m5 12 4 4 10-10" /></>); }
function iconChat() { return svg(<><path d="M4 6h16v10H8l-4 4V6z" /></>); }
function iconMedia() { return svg(<><rect x="3" y="4" width="18" height="14" rx="2" /><path d="m3 15 5-5 5 5" /><circle cx="15" cy="9" r="1.5" /></>); }
function iconBook() { return svg(<><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" /><path d="M5 17h11" /></>); }
function iconMap() { return svg(<><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6z" /><path d="M9 4v14M15 6v14" /></>); }
function iconTeam() { return svg(<><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="17" cy="9" r="2.5" /><path d="M15 20a5 5 0 0 1 6-4" /></>); }
function iconCog() { return svg(<><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>); }
function iconShield() { return svg(<><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" /></>); }
function IconRefresh() { return svg(<><path d="M4 12a8 8 0 0 1 14-5.3L20 9" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-14 5.3L4 15" /><path d="M4 20v-5h5" /></>); }

function svg(children: ReactNode) {
  return (
    <svg className="ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
