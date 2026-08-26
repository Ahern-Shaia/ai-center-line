import Spinner from "./shared/Spinner";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePermissions } from "./permission/PermissionContext";
import Login from "./Login";
import Shell, { canOpenPage, firstAllowedPage, NAV_TITLE, PAGE_GROUP } from "./Shell";
// document.title 在 effect 裡設，不是 render —— 用純函式 t() 而非 useT()
import { t } from "./i18n";
import { useT } from "./i18n/useT";
import WarRoom from "./warroom/WarRoom";
import TaskBoard from "./warroom/TaskBoard";
import DailyLog from "./warroom/DailyLog";
import TaskConfigPage from "./settings/task-config/Page";
import PageTabs from "./shared/PageTabs";
import Rag from "./kb/Rag";
import Onboarding from "./kb/Onboarding";
import PermissionSetupGuide from "./kb/PermissionSetupGuide";
import MediaLibrary from "./kb/MediaLibrary";
import MasterData from "./settings/MasterData";
import KnowledgeBase from "./kb/KnowledgeBase";
import CustomerMap from "./kb/CustomerMap";
import DepartmentsMembers from "./settings/depts-members/Page";
import AuditLog from "./settings/AuditLog";
import RolePermissionsPage from "./settings/role-permissions/Page";
import SchedulerConfigPage from "./settings/scheduler-config/Page";
import LineGroupsPage from "./settings/line-groups/Page";
import TenantBindingAudit from "./settings/TenantBindingAudit";
import ConversationAnalysisUpload from "./convo-analysis/Upload";
import ConversationAnalysisList from "./convo-analysis/List";
import ConversationAnalysisDetail from "./convo-analysis/Detail";
import ConvoInsights from "./convo-analysis/Insights";
import LlmSettings from "./settings/LlmSettings";
import LineBots from "./line-bots/Page";
import TenantManagement from "./aiproot-console/TenantManagement";
import ExtractionHealth from "./aiproot-console/ExtractionHealth";
import CompletionTracking from "./aiproot-console/CompletionTracking";
import { NAV_EVENT, type NavTarget } from "./nav";
import CostDashboard from "./aiproot-console/CostDashboard";
import BatchHistory from "./aiproot-console/BatchHistory";
import BindingAudit from "./aiproot-console/BindingAudit";
import MapConfig from "./aiproot-console/MapConfig";
import NotifyConfigPage from "./notify-config/Page";
import MyDailyReport from "./personal-report/MyDailyReport";
import TeamDailyReport from "./personal-report/TeamDailyReport";
import MyTrips from "./personal-report/MyTrips";
import RolesManagement from "./aiproot-console/RolesManagement";
import FirstLoginChangePassword from "./auth/FirstLoginChangePassword";
import ChangePasswordDialog from "./auth/ChangePasswordDialog";
import { getSession, logout, login, onTokenChange, type Session } from "./api";
import { ToastProvider } from "./Toast";

type Route =
  | { page: "warroom" }
  | { page: "task-board" }
  | { page: "daily-log" }
  | { page: "task-config" }
  | { page: "system-health" }
  | { page: "channels" }
  | { page: "rag" }
  | { page: "onboarding" }
  | { page: "media" }
  | { page: "km" }
  | { page: "map" }
  | { page: "depts"; tab?: "dept" | "member" }
  | { page: "role-permissions" }
  | { page: "audit" }
  | { page: "scheduler-config" }
  | { page: "master-data" }
  | { page: "convo-list" }
  | { page: "convo-upload" }
  | { page: "convo-detail"; uploadId: number }
  | { page: "convo-insights" }
  | { page: "llm-settings" }
  | { page: "line-bots" }
  | { page: "tenant-mgmt" }
  | { page: "map-config" }
  | { page: "notify-config" }
  | { page: "my-daily-report" }
  | { page: "team-report" }
  | { page: "my-trips" }
  | { page: "permission-guide" }
  | { page: "roles-mgmt" };

// crumb 顯示上層分類（非當前頁名），避免與 pane h1 重複。
// pane h1 對應 PAGE_TITLE，同步設定 document.title 提供瀏覽器 tab 辨識。
// ⚠️ 分組名從 Shell 的 NAV 推導，不在這裡手抄一份 —— 抄的那份改了分組就會對不上。
const PAGE_TITLE: Record<string, string> = {
  // 側欄有的頁一律用側欄那個名字 —— 手抄第二份就是下次改名漏掉的地方
  ...NAV_TITLE,
  // 以下是**不在側欄**的頁（從別處點進來的子頁）
  onboarding: "page.onboarding",
  "permission-guide": "page.permissionGuide",
  map: "page.map",
  "convo-detail": "page.convoDetail",
  "convo-insights": "page.convoInsights",
};

// 權限還沒載回來時的暫時落地頁 · 載回來後由 firstAllowedPage 修正（見下方守衛）
function defaultRouteFor(session: Session | null): Route {
  if (session?.role === "employee") return { page: "my-daily-report" };
  return { page: "warroom" };
}

// ⚠️ 這裡原本有一個硬編的 AIPROOT_ONLY_PAGES —— 已於 2026-07-29（M1）刪除。
//
// 那是**第二套閘門**：側欄已經有權限碼，這個 Set 又擋一次，而且是後者說了算。
// 實證後果：「通知設定」「資料來源」寫了權限碼卻被它蓋掉，成了死碼 ——
// 以為調權限就能開放，實際完全沒作用，而且沒有任何檢查會紅。
// 現在只剩一套：Shell.tsx 的 NAV 推導出 PAGE_PERM，側欄與這道守衛共吃同一份。

export default function App() {
  const tr = useT();          // 側欄／麵包屑要跟著語言重繪
  const [session, setSession] = useState<Session | null>(() => getSession());
  const [route, setRoute] = useState<Route>(() => defaultRouteFor(getSession()));
  const [refreshing, setRefreshing] = useState(false);
  const [asOf, setAsOf] = useState<string | undefined>(undefined);
  const prevRoleRef = useRef<string | null>(session?.role ?? null);
  const perms = usePermissions();
  // 權限還沒載回來時不強制守衛（空集合 ≠ 沒有權限）· 見 canOpenPage 的說明
  const permsReady = perms.permissions.size > 0;
  /**
   * ⚠️ 光有 permsReady 不夠。權限載回來的那一瞬間 route 仍是初始猜的那一頁，
   * 而 effect 在 render 之後才跑 —— 中間那一次 render 會把不該掛的頁掛上去，
   * 它一掛載就打自己沒權限的 API，使用者一登入就吃一個紅色 toast。
   * 所以要等「權限到位**而且**這一頁真的打得開」才掛。
   */
  const pageReady = permsReady && canOpenPage(route.page, perms.hasAny, permsReady);

  useEffect(() => {
    if (session) return;
    if (window.location.hash === "#demo") {
      login("gm@taiwanhomecare.demo", "demo123")
        .then(() => setSession(getSession()))
        .catch(() => undefined);
    }
  }, [session]);

  // 顯示名稱同步進 localStorage 後（改名 / 登入拉 /me/permissions）→ 重讀 session，topbar 更新
  useEffect(() => onTokenChange(() => setSession(getSession())), []);

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
    if (session && !canOpenPage(route.page, perms.hasAny, permsReady)) {
      // ⚠️ 不可以退回 defaultRouteFor —— 那是硬編的，可能正是打不開的那一頁，
      //    而 route.page 沒變的話這個 effect 不會再跑，人就卡在空白頁上。
      setRoute({ page: firstAllowedPage(perms.hasAny) } as Route);
    }
  }, [session, route.page, perms.hasAny, permsReady]);

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
    document.title = `${t(PAGE_TITLE[route.page])} · ${t("app.name")}`;
  }, [route.page]);

  if (!session) return <Login onLogin={() => setSession(getSession())} />;

  // 首次登入 / 過期強制改密碼 · 沒改前擋在此頁 · 不可進 shell
  if (session.mustChangePassword) {
    return <FirstLoginChangePassword email={session.email} onDone={() => setSession(getSession())} />;
  }

  const navActive = route.page === "warroom" ? "warroom" : route.page;
  const crumb = PAGE_GROUP[route.page] ? tr(PAGE_GROUP[route.page]) : "";

  /**
   * ⚠️ 這裡原本是一長串逐 key 的 `if (session.role !== ...) return` ——
   * 那是**第三套**閘門（側欄一套、路由守衛一套、這裡再一套），
   * 而且它是硬編角色的，跟 M1 把權限搬進權限表的目的直接抵觸：
   * aiproot 在權限管理頁上把某頁開給客戶，側欄會出現、路由會放行，
   * 但點下去被這裡擋掉 —— 「看得到卻點不動」比看不到更難查。
   * 現在一律問 canOpenPage，跟側欄與路由守衛同一份來源。
   */
  const onNav = (key: string) => {
    if (!canOpenPage(key, perms.hasAny, permsReady)) return;
    if (key === "convo-detail") return;              // 需要 uploadId，只能由卡片點進去
    setRoute({ page: key } as Route);
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
        pageTitle={t(PAGE_TITLE[route.page])}
        onLogout={() => { logout(); setSession(null); }}
        onHelp={() => setRoute({ page: "onboarding" })}
      >
        {/* ⚠️ 權限還沒載回來之前不掛任何頁面。
            初始 route 是猜的（defaultRouteFor），猜錯的話那一頁會先打一次
            自己沒權限的 API —— 使用者一登入就看到紅色 toast，而那是我們自己
            造成的噪音，不是他做錯什麼。 */}
        {!pageReady && <Spinner block />}
        {pageReady && (
        <div key={route.page} className="page-fade">
          {route.page === "warroom" && <WarRoom onRegister={onRegister} onLoadingChange={setRefreshing} />}
          {route.page === "task-board" && <TaskBoard />}
          {route.page === "daily-log" && <DailyLog />}
          {route.page === "task-config" && <TaskConfigPage />}
          {route.page === "rag" && <Rag />}
          {route.page === "onboarding" && <Onboarding onDone={() => setRoute({ page: "warroom" })} />}
          {route.page === "permission-guide" && (
            <PermissionSetupGuide
              onNavigate={(t) => setRoute(t.page === "depts" ? { page: "depts", tab: t.tab } : { page: "channels" })}
              onDone={() => setRoute({ page: "depts", tab: "dept" })}
            />
          )}
          {route.page === "media" && <MediaLibrary />}
          {route.page === "master-data" && <MasterData />}
          {route.page === "km" && <KnowledgeBase />}
          {route.page === "map" && <CustomerMap />}
          {route.page === "depts" && <DepartmentsMembers initialTab={route.tab} onOpenGuide={() => setRoute({ page: "permission-guide" })} />}
          {route.page === "role-permissions" && <RolePermissionsPage />}
          {route.page === "audit" && <AuditLog />}
          {route.page === "scheduler-config" && <SchedulerConfigPage />}
          {/* 通訊管道 · 兩頁合一（M4）。群組與員工綁定都是「誰在哪個管道上」，
              未來接 Discord 等就是同一頁多一個 tab（對齊 channel-adapter 的方向）。 */}
          {route.page === "channels" && (
            <PageTabs ariaLabel="LINE 群組" tabs={[
              { key: "groups", label: "LINE 群組", perm: "line-groups:view", render: () => <LineGroupsPage /> },
              { key: "binding", label: "員工綁定", perm: "binding:view", render: () => <TenantBindingAudit /> },
              // aiproot 的跨租戶版。原本是另一個側欄項目「LINE 綁定稽核」——
              // 跟上面那個 tab 是同一件事，只是看的範圍不同（§1.3 兩個入口）
              { key: "binding-audit", label: "綁定稽核", perm: "binding:aiproot-view", render: () => <BindingAudit /> },
            ]} />
          )}
          {route.page === "convo-list" && (
            <ConversationAnalysisList
              onOpen={(id) => setRoute({ page: "convo-detail", uploadId: id })}
              onNewUpload={() => setRoute({ page: "convo-upload" })}
              onInsights={() => setRoute({ page: "convo-insights" })}
            />
          )}
          {route.page === "convo-insights" && (
            <ConvoInsights onBack={() => setRoute({ page: "convo-list" })} />
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
          {route.page === "tenant-mgmt" && <TenantManagement />}
          {/* 系統健康 · 四頁合一（M4）。這四頁回答的是同一個問題「這套系統跑得好不好」，
              而且互相解釋 —— 成本高不高要看分析量、接住率低要看抽取健康度。
              分成四個入口的結果是每一個都要點進去看一眼。 */}
          {route.page === "system-health" && (
            <PageTabs ariaLabel="系統健康" tabs={[
              { key: "extraction", label: "抽取健康度", perm: "extraction-health:view", render: () => <ExtractionHealth /> },
              { key: "completion", label: "任務完成追蹤", perm: "completion-tracking:view", render: () => <CompletionTracking /> },
              { key: "batches", label: "對話分析歷程", perm: "batch-history:view",
                render: () => <BatchHistory onOpenAnalysis={(id) => setRoute({ page: "convo-detail", uploadId: id })} /> },
              { key: "cost", label: "AI 成本", perm: "cost-dashboard:view",
                render: () => <CostDashboard onOpenAnalysis={(id) => setRoute({ page: "convo-detail", uploadId: id })} /> },
            ]} />
          )}
          {route.page === "map-config" && <MapConfig />}
          {route.page === "notify-config" && <NotifyConfigPage />}
          {route.page === "my-daily-report" && <MyDailyReport />}
          {route.page === "team-report" && <TeamDailyReport />}
          {route.page === "my-trips" && <MyTrips />}
          {route.page === "roles-mgmt" && <RolesManagement />}
        </div>
        )}
      </Shell>
    </ToastProvider>
  );
}
