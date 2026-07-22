import type { ReactNode } from "react";
import { Button as AriaButton, Header as AriaHeader, Menu, MenuItem, MenuTrigger, Popover, Separator } from "react-aria-components";
import { useState } from "react";
import type { Role, Session } from "./api";
import { useToast } from "./Toast";
import ChangePasswordDialog from "./auth/ChangePasswordDialog";

// 對照 docs/台灣福祉_系統設計文件_開發用.md §1-C C3 tenant_admin 8 module 全景。
// 全部走 mock 資料頁面（demo 錄影用）；正式版逐步接後端。
// 通訊接頭層等平台方項目透過 roles 過濾 · 不歸客戶 tenant_admin 管
const NAV: Array<{
  group: string;
  roles?: Role[];              // 未設 = 全角色可見
  items: Array<{ key: string; label: string; ic: () => ReactNode; done: boolean }>;
}> = [
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
      { key: "rag", label: "智慧檢索", ic: iconChat, done: true },
      { key: "media", label: "素材看板", ic: iconMedia, done: true },
      { key: "km", label: "知識庫", ic: iconBook, done: true },
      { key: "map", label: "客戶地圖", ic: iconMap, done: true },
    ],
  },
  {
    group: "AI 對話分析",
    roles: ["aiproot_admin", "consultant"],   // 分析設定屬 aiproot 側維護 · tenant 只在戰情室看最終結果
    items: [
      { key: "convo-list", label: "分析列表", ic: iconChat, done: true },
      { key: "convo-upload", label: "上傳新對話", ic: iconMedia, done: true },
      { key: "llm-settings", label: "語言模型設定", ic: iconCog, done: true },
    ],
  },
  {
    group: "通訊接頭層",
    roles: ["aiproot_admin", "consultant"],   // 我方平台管理項 · 客戶方看不到
    items: [
      { key: "line-bots", label: "LINE 機器人", ic: iconChat, done: true },
    ],
  },
  {
    group: "設定",
    items: [
      { key: "depts", label: "部門/成員", ic: iconTeam, done: true },
      { key: "config", label: "租戶設定", ic: iconCog, done: true },
      { key: "audit", label: "稽核記錄", ic: iconShield, done: true },
    ],
  },
  {
    group: "AIPROOT 管理",
    roles: ["aiproot_admin", "consultant"],
    items: [
      { key: "onboard-tenant", label: "開通新租戶", ic: iconTeam, done: true },
      { key: "cost-dashboard", label: "AI 成本管理", ic: iconGauge, done: true },
      { key: "batch-history", label: "對話分析歷程", ic: iconChat, done: true },
      { key: "binding-audit", label: "LINE 綁定 audit", ic: iconTeam, done: true },
      { key: "category-mgmt", label: "分類管理", ic: iconBook, done: true },
    ],
  },
];

const ROLE_LABEL: Record<string, string> = {
  aiproot_admin: "AIPROOT 管理員",
  consultant: "顧問",
  tenant_admin: "總經理室",
  group_owner: "群組負責人",
};

// TODO(iam-followup): JWT 應內含 tenant_name · 目前 hard-code 補
// 現在有 2 個 tenant · 未來 wizard 加更多會沒 match → fallback 顯 tenant slug
const TENANT_NAME: Record<string, string> = {
  "77777777-0000-0000-0000-000000000001": "aiproot",
  "4d97eced-64c5-4a38-952b-dfce9588ab7c": "台灣福祉",
};

// 方向 A · role-aware sidebar brand
function brandFor(session: Session): { mark: string; name: string; sub: string } {
  if (session.role === "aiproot_admin") {
    return { mark: "A", name: "AIPROOT", sub: "平台後台" };
  }
  if (session.role === "consultant") {
    return { mark: "A", name: "AIPROOT", sub: "顧問視角" };
  }
  const tenantName = TENANT_NAME[session.tenantId] ?? "客戶方";
  return { mark: tenantName.slice(0, 1), name: tenantName, sub: "戰情室" };
}

interface Props {
  session: Session;
  active: string;
  pageTitle?: string;                              // 頂 topbar breadcrumb 的當前頁名稱
  onNav: (key: string) => void;
  onLogout: () => void;
  onRefresh: () => void;
  onHelp?: () => void;
  refreshing?: boolean;
  asOf?: string;
  crumb?: string;
  children: ReactNode;
}

export default function Shell({ session, active, pageTitle, onNav, onLogout, onRefresh, onHelp, refreshing, asOf, crumb, children }: Props) {
  const tenantName = TENANT_NAME[session.tenantId] ?? "客戶方";
  const brand = brandFor(session);
  const toast = useToast();
  const initials = session.email.slice(0, 2).toUpperCase();
  const [changePwOpen, setChangePwOpen] = useState(false);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sb-brand" title={brand.name}>
          <span className="sb-brand-mark" aria-hidden>{brand.mark}</span>
          <div className="sb-brand-text">
            <div className="sb-brand-name">{brand.name}</div>
            <div className="sb-brand-sub">{brand.sub}</div>
          </div>
        </div>
        <nav className="sb-nav">
          {NAV.filter((g) => !g.roles || g.roles.includes(session.role)).map((g) => (
            <div key={g.group}>
              <div className="sb-group">{g.group}</div>
              {g.items.map((it) => (
                <button
                  key={it.key}
                  className={`sb-link${active === it.key ? " active" : ""}${!it.done ? " planned" : ""}`}
                  onClick={() => it.done ? onNav(it.key) : toast.show(`「${it.label}」規劃於後續版本推出`)}
                  aria-current={active === it.key ? "page" : undefined}
                >
                  <it.ic />
                  <span>{it.label}</span>
                  {!it.done && <span className="sb-plan-dot" aria-label="規劃中" title="規劃中" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sb-foot">
          <div><span className="sb-foot-brand">aiproot</span> 技術支援</div>
          <div className="sb-foot-ver">v0.1</div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="topbar-inner">
          <div className="crumb">
            {crumb && <><b>{crumb}</b><span className="sep" aria-hidden>›</span></>}
            <span className="cur">{pageTitle ?? crumb ?? "總覽"}</span>
          </div>
          <div className="topbar-spacer" />
          {asOf && (
            <span className="as-of">
              <span className="dot" />
              資料截止 {new Date(asOf).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {onHelp && (
            <button className="icon-btn" onClick={onHelp} aria-label="運作原理" title="運作原理">
              <IconHelp />
            </button>
          )}
          <button className={`icon-btn${refreshing ? " spin" : ""}`} onClick={onRefresh} aria-label="重新整理" title="重新整理">
            <IconRefresh />
          </button>
          <MenuTrigger>
            <AriaButton className="user-btn">
              <span className="user-avatar">{initials}</span>
              <span className="user-meta">
                <span className="user-name">{session.email.split("@")[0]}</span>
                <span className="user-role">{ROLE_LABEL[session.role] ?? session.role}</span>
              </span>
            </AriaButton>
            <Popover className="user-menu-pop" placement="bottom right" offset={6}>
              <Menu className="user-menu" onAction={(key) => {
                if (key === "logout") onLogout();
                else if (key === "change-password") setChangePwOpen(true);
              }}>
                <AriaHeader className="user-menu-hdr">
                  <div className="n">{session.email.split("@")[0]}</div>
                  <div className="e">{session.email}</div>
                  <div className="t">{ROLE_LABEL[session.role] ?? session.role} · {tenantName}</div>
                </AriaHeader>
                <Separator className="user-menu-sep" />
                <MenuItem id="change-password">變更密碼</MenuItem>
                <MenuItem id="switch" isDisabled>切換租戶</MenuItem>
                <MenuItem id="logout" className="danger">登出</MenuItem>
              </Menu>
            </Popover>
          </MenuTrigger>
          </div>
        </div>
        <main className="pane">{children}</main>
      </div>
      <ChangePasswordDialog open={changePwOpen} onClose={() => setChangePwOpen(false)} />
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
function IconHelp() { return svg(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2.5-2.5 4M12 17h.01" /></>); }

function svg(children: ReactNode) {
  return (
    <svg className="ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
