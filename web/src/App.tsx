import { useCallback, useEffect, useRef, useState } from "react";
import Login from "./Login";
import Shell from "./Shell";
import WarRoom from "./warroom/WarRoom";
import Rag from "./kb/Rag";
import Onboarding from "./kb/Onboarding";
import MediaLibrary from "./kb/MediaLibrary";
import KnowledgeBase from "./kb/KnowledgeBase";
import CustomerMap from "./kb/CustomerMap";
import DepartmentsMembers from "./settings/depts-members/Page";
import TenantSettings from "./settings/TenantSettings";
import AuditLog from "./settings/AuditLog";
import SchedulerConfigPage from "./settings/scheduler-config/Page";
import LineGroupsPage from "./settings/line-groups/Page";
import TenantBindingAudit from "./settings/TenantBindingAudit";
import ConversationAnalysisUpload from "./convo-analysis/Upload";
import ConversationAnalysisList from "./convo-analysis/List";
import ConversationAnalysisDetail from "./convo-analysis/Detail";
import LlmSettings from "./settings/LlmSettings";
import LineBots from "./line-bots/Page";
import OnboardWizard from "./aiproot-console/OnboardWizard";
import TenantManagement from "./aiproot-console/TenantManagement";
import ExtractionHealth from "./aiproot-console/ExtractionHealth";
import { NAV_EVENT, type NavTarget } from "./nav";
import CostDashboard from "./aiproot-console/CostDashboard";
import BatchHistory from "./aiproot-console/BatchHistory";
import BindingAudit from "./aiproot-console/BindingAudit";
import CategoryManagement from "./aiproot-console/CategoryManagement";
import MapConfig from "./aiproot-console/MapConfig";
import NotifyConfigPage from "./notify-config/Page";
import MyDailyReport from "./personal-report/MyDailyReport";
import MyTrips from "./personal-report/MyTrips";
import RolesManagement from "./aiproot-console/RolesManagement";
import FirstLoginChangePassword from "./auth/FirstLoginChangePassword";
import ChangePasswordDialog from "./auth/ChangePasswordDialog";
import { getSession, logout, login, type Session } from "./api";
import { ToastProvider } from "./Toast";

type Route =
  | { page: "warroom" }
  | { page: "rag" }
  | { page: "onboarding" }
  | { page: "media" }
  | { page: "km" }
  | { page: "map" }
  | { page: "depts" }
  | { page: "config" }
  | { page: "audit" }
  | { page: "scheduler-config" }
  | { page: "line-groups" }
  | { page: "tenant-binding" }
  | { page: "convo-list" }
  | { page: "convo-upload" }
  | { page: "convo-detail"; uploadId: number }
  | { page: "llm-settings" }
  | { page: "line-bots" }
  | { page: "onboard-tenant" }
  | { page: "tenant-mgmt" }
  | { page: "extraction-health" }
  | { page: "cost-dashboard" }
  | { page: "batch-history" }
  | { page: "binding-audit" }
  | { page: "map-config" }
  | { page: "notify-config" }
  | { page: "category-mgmt" }
  | { page: "my-daily-report" }
  | { page: "my-trips" }
  | { page: "roles-mgmt" };

// crumb 顯示上層分類（非當前頁名），避免與 pane h1 重複。
// pane h1 對應 PAGE_TITLE，同步設定 document.title 提供瀏覽器 tab 辨識。
const CRUMB: Record<Route["page"], string> = {
  warroom: "戰情室",
  rag: "資料 · 知識",
  onboarding: "說明",
  media: "資料 · 知識",
  km: "資料 · 知識",
  map: "資料 · 知識",
  depts: "設定",
  config: "設定",
  audit: "設定",
  "scheduler-config": "設定",
  "line-groups": "設定",
  "tenant-binding": "設定",
  "convo-list": "AI 對話分析",
  "convo-upload": "AI 對話分析",
  "convo-detail": "AI 對話分析",
  "llm-settings": "AI 對話分析",
  "line-bots": "通訊接頭層",
  "onboard-tenant": "AIPROOT 管理",
  "tenant-mgmt": "AIPROOT 管理",
  "extraction-health": "AIPROOT 管理",
  "cost-dashboard": "AIPROOT 管理",
  "batch-history": "AIPROOT 管理",
  "binding-audit": "AIPROOT 管理",
  "map-config": "AIPROOT 管理",
  "notify-config": "AIPROOT 管理",
  "category-mgmt": "AIPROOT 管理",
  "my-daily-report": "戰情室",
  "my-trips": "戰情室",
  "roles-mgmt": "AIPROOT 管理",
};

const PAGE_TITLE: Record<Route["page"], string> = {
  warroom: "總覽儀表",
  rag: "智慧檢索",
  onboarding: "運作原理",
  media: "素材看板",
  km: "知識庫",
  map: "客戶地圖",
  depts: "部門 / 成員",
  config: "公司設定",
  audit: "稽核記錄",
  "scheduler-config": "定時任務",
  "line-groups": "LINE 群組",
  "tenant-binding": "員工 LINE 綁定",
  "convo-list": "分析列表",
  "convo-upload": "上傳新對話",
  "convo-detail": "分析詳情",
  "llm-settings": "語言模型設定",
  "line-bots": "LINE 機器人管理",
  "onboard-tenant": "開通新租戶",
  "tenant-mgmt": "租戶管理",
  "extraction-health": "抽取健康度",
  "cost-dashboard": "AI 成本管理",
  "batch-history": "對話分析歷程",
  "binding-audit": "LINE 綁定稽核",
  "map-config": "地圖里程設定",
  "notify-config": "通知設定",
  "category-mgmt": "分類管理",
  "my-daily-report": "我的日報",
  "my-trips": "我的行程",
  "roles-mgmt": "權限管理",
};

// employee 沒 warroom-tasks:view · 若 default 進 warroom 會 toast 洗版
// 依 role 決定 landing · employee → 我的日報 · 其他 → 總覽儀表
function defaultRouteFor(session: Session | null): Route {
  if (session?.role === "employee") return { page: "my-daily-report" };
  return { page: "warroom" };
}

// aiproot 平台方專屬頁面 · 對 tenant_admin / group_owner / employee 不該顯示
// 注意 · "line-groups" 不在此 set · 開放給 tenant_admin（perm gate 在 sidebar 過濾）
const AIPROOT_ONLY_PAGES = new Set([
  "convo-list", "convo-upload", "convo-detail",
  "llm-settings", "line-bots",
  "onboard-tenant", "tenant-mgmt", "extraction-health", "cost-dashboard", "batch-history",
  "binding-audit", "map-config", "notify-config", "category-mgmt", "roles-mgmt",
]);

function isPageAllowedForRole(page: string, role: string): boolean {
  if (AIPROOT_ONLY_PAGES.has(page) && role !== "aiproot_admin" && role !== "consultant") return false;
  if (page === "tenant-binding" && role !== "tenant_admin") return false;   // 客戶方自治頁 · 僅 tenant_admin
  if (page === "warroom" && role === "employee") return false;
  return true;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => getSession());
  const [route, setRoute] = useState<Route>(() => defaultRouteFor(getSession()));
  const [refreshing, setRefreshing] = useState(false);
  const [asOf, setAsOf] = useState<string | undefined>(undefined);
  const prevRoleRef = useRef<string | null>(session?.role ?? null);

  useEffect(() => {
    if (session) return;
    if (window.location.hash === "#demo") {
      login("gm@taiwanhomecare.demo", "demo123")
        .then(() => setSession(getSession()))
        .catch(() => undefined);
    }
  }, [session]);

  // 深層元件跨頁導航（TaskBoard / DailyLog → 分析詳情）
  // 原本靠 window.location.hash，但這裡從未監聽 hashchange → 點了沒反應
  useEffect(() => {
    const onNavEvent = (e: Event) => {
      const t = (e as CustomEvent<NavTarget>).detail;
      if (t?.page === "convo-detail" && Number.isFinite(t.uploadId)) {
        setRoute({ page: "convo-detail", uploadId: t.uploadId });
      }
    };
    window.addEventListener(NAV_EVENT, onNavEvent);
    return () => window.removeEventListener(NAV_EVENT, onNavEvent);
  }, []);

  // P0 · session 切換時強制 reset route · 避免舊 admin 頁面殘留（切帳號看到別人資料的 bug）
  // - null → 有值（login）：重設到新 role 的 default
  // - A role → B role（切帳號）：重設到新 role 的 default
  // - 有值 → null（logout）：直接進 Login 頁 · route 保留無影響
  useEffect(() => {
    const currentRole = session?.role ?? null;
    if (currentRole && prevRoleRef.current !== currentRole) {
      setRoute(defaultRouteFor(session));
    }
    prevRoleRef.current = currentRole;
  }, [session]);

  // P0 defense in depth · 任何時刻 route 對當前 role 不允許 · 立即 reset
  // 防止 stale route / URL 直接 nav / 未來 nav 邏輯漏擋
  useEffect(() => {
    if (session && !isPageAllowedForRole(route.page, session.role)) {
      setRoute(defaultRouteFor(session));
    }
  }, [session, route.page]);

  const pageRef = useRef<{ refresh: () => Promise<void>; asOf: () => string | undefined }>({
    refresh: async () => undefined,
    asOf: () => undefined,
  });
  const onRegister = useCallback((fns: { refresh: () => Promise<void>; asOf: () => string | undefined }) => {
    pageRef.current = fns;
    setAsOf(fns.asOf());
  }, []);
  const onRefresh = useCallback(async () => {
    await pageRef.current.refresh();
    setAsOf(pageRef.current.asOf());
  }, []);

  useEffect(() => {
    document.title = `${PAGE_TITLE[route.page]} · aiproot 戰情室`;
  }, [route.page]);

  if (!session) return <Login onLogin={() => setSession(getSession())} />;

  // 首次登入 / 過期強制改密碼 · 沒改前擋在此頁 · 不可進 shell
  if (session.mustChangePassword) {
    return <FirstLoginChangePassword email={session.email} onDone={() => setSession(getSession())} />;
  }

  const navActive = route.page === "warroom" ? "warroom" : route.page;
  const crumb = CRUMB[route.page];

  const onNav = (key: string) => {
    if (key === "warroom") setRoute({ page: "warroom" });
    else if (key === "rag" || key === "media" || key === "km" || key === "map"
      || key === "depts" || key === "config" || key === "audit" || key === "scheduler-config" || key === "line-groups") {
      setRoute({ page: key });
    } else if (key === "tenant-binding") {
      // 客戶方自治 · 僅 tenant_admin（自租戶 LINE 綁定管理）
      if (session.role !== "tenant_admin") return;
      setRoute({ page: "tenant-binding" });
    } else if (key === "convo-list" || key === "convo-upload" || key === "llm-settings") {
      // AI 對話分析設定屬 aiproot 側維護 · tenant 只在戰情室看結果
      if (session.role !== "aiproot_admin" && session.role !== "consultant") return;
      setRoute({ page: key });
    } else if (key === "line-bots") {
      // 通訊接頭層屬 aiproot 平台方管理 · 非 aiproot_admin / consultant 擋下
      if (session.role !== "aiproot_admin" && session.role !== "consultant") return;
      setRoute({ page: "line-bots" });
    } else if (key === "onboard-tenant") {
      if (session.role !== "aiproot_admin") return;
      setRoute({ page: "onboard-tenant" });
    } else if (key === "tenant-mgmt") {
      // 含重設密碼 · 僅 aiproot_admin（consultant 不給動客戶帳號）
      if (session.role !== "aiproot_admin") return;
      setRoute({ page: "tenant-mgmt" });
    } else if (key === "extraction-health") {
      if (session.role !== "aiproot_admin" && session.role !== "consultant") return;
      setRoute({ page: "extraction-health" });
    } else if (key === "cost-dashboard") {
      if (session.role !== "aiproot_admin" && session.role !== "consultant") return;
      setRoute({ page: "cost-dashboard" });
    } else if (key === "batch-history") {
      if (session.role !== "aiproot_admin" && session.role !== "consultant") return;
      setRoute({ page: "batch-history" });
    } else if (key === "binding-audit") {
      if (session.role !== "aiproot_admin" && session.role !== "consultant") return;
      setRoute({ page: "binding-audit" });
    } else if (key === "map-config") {
      if (session.role !== "aiproot_admin" && session.role !== "consultant") return;
      setRoute({ page: "map-config" });
    } else if (key === "notify-config") {
      if (session.role !== "aiproot_admin" && session.role !== "consultant") return;
      setRoute({ page: "notify-config" });
    } else if (key === "category-mgmt") {
      if (session.role !== "aiproot_admin" && session.role !== "consultant") return;
      setRoute({ page: "category-mgmt" });
    } else if (key === "my-daily-report") {
      setRoute({ page: "my-daily-report" });
    } else if (key === "my-trips") {
      setRoute({ page: "my-trips" });
    } else if (key === "roles-mgmt") {
      if (session.role !== "aiproot_admin") return;
      setRoute({ page: "roles-mgmt" });
    }
  };

  return (
    <ToastProvider>
      <Shell
        session={session}
        active={navActive}
        onNav={onNav}
        onRefresh={onRefresh}
        refreshing={refreshing}
        asOf={route.page === "warroom" ? asOf : undefined}
        crumb={crumb}
        pageTitle={PAGE_TITLE[route.page]}
        onLogout={() => { logout(); setSession(null); }}
        onHelp={() => setRoute({ page: "onboarding" })}
      >
        {/* key 觸發 remount → CSS animation on mount，切換頁面時 fade+slide 進場 */}
        <div key={route.page} className="page-fade">
          {route.page === "warroom" && <WarRoom onRegister={onRegister} onLoadingChange={setRefreshing} />}
          {route.page === "rag" && <Rag />}
          {route.page === "onboarding" && <Onboarding onDone={() => setRoute({ page: "warroom" })} />}
          {route.page === "media" && <MediaLibrary />}
          {route.page === "km" && <KnowledgeBase />}
          {route.page === "map" && <CustomerMap />}
          {route.page === "depts" && <DepartmentsMembers />}
          {route.page === "config" && <TenantSettings />}
          {route.page === "audit" && <AuditLog />}
          {route.page === "scheduler-config" && <SchedulerConfigPage />}
          {route.page === "line-groups" && <LineGroupsPage />}
          {route.page === "tenant-binding" && <TenantBindingAudit />}
          {route.page === "convo-list" && (
            <ConversationAnalysisList
              onOpen={(id) => setRoute({ page: "convo-detail", uploadId: id })}
              onNewUpload={() => setRoute({ page: "convo-upload" })}
            />
          )}
          {route.page === "convo-upload" && (
            <ConversationAnalysisUpload
              onUploaded={() => setRoute({ page: "convo-list" })}
            />
          )}
          {route.page === "convo-detail" && (
            <ConversationAnalysisDetail
              uploadId={route.uploadId}
              onBack={() => setRoute({ page: "convo-list" })}
            />
          )}
          {route.page === "llm-settings" && <LlmSettings />}
          {route.page === "line-bots" && <LineBots />}
          {route.page === "onboard-tenant" && <OnboardWizard />}
          {route.page === "tenant-mgmt" && <TenantManagement />}
          {route.page === "extraction-health" && <ExtractionHealth />}
          {route.page === "cost-dashboard" && (
            <CostDashboard onOpenAnalysis={(id) => setRoute({ page: "convo-detail", uploadId: id })} />
          )}
          {route.page === "batch-history" && (
            <BatchHistory onOpenAnalysis={(id) => setRoute({ page: "convo-detail", uploadId: id })} />
          )}
          {route.page === "binding-audit" && <BindingAudit />}
          {route.page === "map-config" && <MapConfig />}
          {route.page === "notify-config" && <NotifyConfigPage />}
          {route.page === "category-mgmt" && <CategoryManagement />}
          {route.page === "my-daily-report" && <MyDailyReport />}
          {route.page === "my-trips" && <MyTrips />}
          {route.page === "roles-mgmt" && <RolesManagement />}
        </div>
      </Shell>
    </ToastProvider>
  );
}
