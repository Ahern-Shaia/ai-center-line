import type { ReactNode } from "react";
import { Button as AriaButton, Header as AriaHeader, Menu, MenuItem, MenuTrigger, Popover, Separator } from "react-aria-components";
import { useState } from "react";
import type { Session } from "./api";
import { useToast } from "./Toast";
import { usePermissions } from "./permission/PermissionContext";
import ChangePasswordDialog from "./auth/ChangePasswordDialog";

// 對照 docs/roles-permissions-matrix.md · 每個 item 綁 permission
//
// ⚠️ 這份表是**唯一**的閘門來源：側欄顯不顯示、路由進不進得去，都由它決定。
//    2026-07-29（M1）之前還有第二套 —— App.tsx 裡一個硬編的 AIPROOT_ONLY_PAGES。
//    兩套並存的後果實測過：「通知設定」「資料來源」明明寫了權限碼，
//    卻被那個 Set 蓋掉，等於死碼；以為調權限就能開放，實際完全沒作用。
//    所以要新增頁面，只加在這裡，不要在別處再開一個名單。
//
// - 沒設 perm = 全角色可見（RLS 已 scope 內容）
// - 設 perm / permAny = 依 usePermissions 過濾
const NAV: Array<{
  group: string;
  items: Array<{
    key: string;
    label: string;
    ic: () => ReactNode;
    done: boolean;
    perm?: string;              // 有這 perm 才顯示（沒設 = 全顯）
    permAny?: string[];         // 任一 perm 有就顯
  }>;
}> = [
  {
    group: "戰情室",
    items: [
      // 我的日報 / 我的行程 · 全角色可見 · employee 也看得到 · 主管也自己填/跑外勤
      { key: "my-daily-report", label: "我的日報", ic: iconBook, done: true, perm: "personal-report:mine" },
      { key: "my-trips", label: "我的行程", ic: iconMap, done: true, perm: "trips:mine" },
      // 總覽儀表 · 主管級才顯 (employee 只看得到我的日報)
      // 「每日簽核」已移除：它指向的就是 warroom 同一頁（簽核區塊在總覽儀表下半部），
      // 點了路由不變、側欄高亮也不會動 —— 對使用者就是「點了沒反應」。
      // 單筆簽核在任務看板的卡片抽屜；部門每日確認在總覽儀表。
      { key: "warroom", label: "總覽儀表", ic: iconGauge, done: true, perm: "warroom-tasks:view" },
    ],
  },
  {
    group: "資料 · 知識",
    items: [
      // 智慧檢索 / 知識庫 / 客戶地圖 先不掛出來：這三頁還在吃寫死的示範資料，
      // 後端也尚未有對應端點。客戶看不到 > 客戶看到假的（同 2026-07-27 下架的公司設定頁）。
      // 各自的模組排上後再放回來。
      { key: "media", label: "素材看板", ic: iconMedia, done: true, perm: "media:view" },
    ],
  },
  {
    group: "AI 對話分析",
    items: [
      { key: "convo-list", label: "分析列表", ic: iconChat, done: true, perm: "convo:view" },
      { key: "convo-upload", label: "上傳新對話", ic: iconMedia, done: true, perm: "convo:upload" },
      { key: "llm-settings", label: "語言模型設定", ic: iconCog, done: true, perm: "llm-config:view" },
    ],
  },
  {
    group: "通訊接頭層",
    items: [
      { key: "line-bots", label: "LINE 機器人", ic: iconChat, done: true, perm: "line-bots:view" },
    ],
  },
  {
    group: "設定",
    items: [
      // v2 · 部門/成員 開放給 tenant_admin (自 tenant) + aiproot
      { key: "depts", label: "部門/成員", ic: iconTeam, done: true, permAny: ["departments:view", "users:view"] },
      { key: "line-groups", label: "LINE 群組", ic: iconChat, done: true, perm: "line-groups:view" },
      // 客戶方自治 · 僅 tenant_admin 看得到 (aiproot 有自己的跨租戶版在 AIPROOT 管理)
      { key: "tenant-binding", label: "員工 LINE 綁定", ic: iconTeam, done: true, perm: "binding:view" },
      // 「公司設定」暫時下架（2026-07-27）：整頁 24 項全是示範資料，而且對客戶做假承諾 ——
      // 「工研院知識庫 已啟用 · 契約有效期至 2027-06」「員工 opt-out 已啟用」
      // 「影像自動遮罩 臉部/車牌/證件」這些功能都不存在。
      // 寧可沒有這頁，也不可在客戶畫面上放做不到的東西。真實設定散在
      // 定時任務 / 語言模型設定 / LINE 群組 各頁，等有真資料再重做。
      // { key: "config", label: "公司設定", ic: iconCog, done: true, perm: "tenant-config:view" },
      { key: "scheduler-config", label: "定時任務", ic: iconCog, done: true, perm: "scheduler-config:view" },
      { key: "audit", label: "稽核記錄", ic: iconShield, done: true, perm: "audit:view" },
    ],
  },
  {
    group: "AIPROOT 管理",
    items: [
      { key: "onboard-tenant", label: "開通新租戶", ic: iconTeam, done: true, perm: "tenants:onboard" },
      // 含重設密碼 → 只給 aiproot_admin（顧問看得到卻點不動＝更糟的體驗）
      { key: "tenant-mgmt", label: "租戶管理", ic: iconTeam, done: true, perm: "tenants:manage" },
      { key: "extraction-health", label: "抽取健康度", ic: iconGauge, done: true, perm: "extraction-health:view" },
      { key: "completion-tracking", label: "任務完成追蹤", ic: iconGauge, done: true, perm: "completion-tracking:view" },
      { key: "cost-dashboard", label: "AI 成本管理", ic: iconGauge, done: true, perm: "cost-dashboard:view" },
      { key: "batch-history", label: "對話分析歷程", ic: iconChat, done: true, perm: "batch-history:view" },
      { key: "binding-audit", label: "LINE 綁定稽核", ic: iconTeam, done: true, perm: "binding:aiproot-view" },
      { key: "map-config", label: "地圖里程設定", ic: iconCog, done: true, perm: "map-config:view" },
      { key: "notify-config", label: "通知設定", ic: iconChat, done: true, perm: "notify-config:view" },
      // 資料來源與通知設定共用同一組 Ragic 憑證，權限也一致（我方維護）
      { key: "master-data", label: "資料來源", ic: iconBook, done: true, perm: "notify-config:view" },
      { key: "category-mgmt", label: "分類管理", ic: iconBook, done: true, perm: "categories:view" },
      { key: "roles-mgmt", label: "權限管理", ic: iconShield, done: true, perm: "roles:view" },
    ],
  },
];

/**
 * 頁面 → 所需權限（任一即可）。由上面的 NAV 推導，**不是**另一份手抄名單。
 * App.tsx 的路由守衛吃這個，於是「側欄看得到」與「路由進得去」不可能再分岔。
 */
export const PAGE_PERM: Record<string, string[]> = {
  ...Object.fromEntries(
    NAV.flatMap((g) => g.items).flatMap((it) => {
      const need = it.perm ? [it.perm] : it.permAny ?? [];
      return need.length ? [[it.key, need] as const] : [];
    }),
  ),
  // 不在側欄、但可從別頁點進去的子頁也要有閘門
  "convo-detail": ["convo:view"],
};

/**
 * 這個人進得去這一頁嗎？
 *
 * ⚠️ `ready` 為 false（權限還沒載回來）時一律放行 —— 否則登入後那一瞬間
 * 權限是空集合，使用者會被彈回預設頁，看起來像「點什麼都沒反應」。
 * 前端這道是體驗，真正的安全在後端：守衛已 fail-closed，端點各自要權限碼。
 */
export function canOpenPage(page: string, hasAny: (...p: string[]) => boolean, ready: boolean): boolean {
  if (!ready) return true;
  const need = PAGE_PERM[page];
  return !need || hasAny(...need);
}

const COLLAPSED_KEY = "sb_collapsed_groups";

const ROLE_LABEL: Record<string, string> = {
  aiproot_admin: "AIPROOT 管理員",
  consultant: "顧問",
  tenant_admin: "總經理室",
  group_owner: "群組負責人",
  employee: "一般員工",
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const perms = usePermissions();
  const itemVisible = (it: { perm?: string; permAny?: string[] }) => {
    if (it.perm) return perms.has(it.perm);
    if (it.permAny) return perms.hasAny(...it.permAny);
    return true;
  };

  const handleNav = (key: string) => {
    setMobileNavOpen(false);
    onNav(key);
  };

  const visibleNav = NAV
    .map((g) => ({ ...g, items: g.items.filter(itemVisible) }))
    .filter((g) => g.items.length > 0);

  // 收合狀態存 localStorage：功能持續增加，每次重整都要重收一次會很煩
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as string[]; }
    catch { return []; }
  });
  const toggleGroup = (group: string) => {
    setCollapsed((s) => {
      const next = s.includes(group) ? s.filter((g) => g !== group) : [...s, group];
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <div className={`app${mobileNavOpen ? " mobile-nav-open" : ""}`}>
      {mobileNavOpen && <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden />}
      <aside className="sidebar">
        <div className="sb-brand" title={brand.name}>
          <span className="sb-brand-mark" aria-hidden>{brand.mark}</span>
          <div className="sb-brand-text">
            <div className="sb-brand-name">{brand.name}</div>
            <div className="sb-brand-sub">{brand.sub}</div>
          </div>
          <button className="sb-close" onClick={() => setMobileNavOpen(false)} aria-label="關閉選單">×</button>
        </div>
        <nav className="sb-nav">
          {visibleNav.map((g) => {
            // 目前所在的分組永遠展開——否則點進去後選單自己收起來，會找不到自己在哪
            const hasActive = g.items.some((it) => it.key === active);
            const open = hasActive || !collapsed.includes(g.group);
            return (
              <div key={g.group}>
                <button
                  className={`sb-group sb-group-btn${open ? "" : " collapsed"}`}
                  onClick={() => toggleGroup(g.group)}
                  aria-expanded={open}
                >
                  <span>{g.group}</span>
                  <svg className="sb-chev" width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {open && g.items.map((it) => (
                  <button
                    key={it.key}
                    className={`sb-link${active === it.key ? " active" : ""}${!it.done ? " planned" : ""}`}
                    onClick={() => it.done ? handleNav(it.key) : toast.show(`「${it.label}」規劃於後續版本推出`)}
                    aria-current={active === it.key ? "page" : undefined}
                  >
                    <it.ic />
                    <span>{it.label}</span>
                    {!it.done && <span className="sb-plan-dot" aria-label="規劃中" title="規劃中" />}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sb-foot">
          <div><span className="sb-foot-brand">aiproot</span> 技術支援</div>
          <div className="sb-foot-ver">v0.1</div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="topbar-inner">
          <button className="mobile-menu-btn" onClick={() => setMobileNavOpen(true)} aria-label="選單">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
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
