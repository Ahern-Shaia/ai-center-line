import { useCallback, useEffect, useRef, useState } from "react";
import Login from "./Login";
import Shell from "./Shell";
import WarRoom from "./WarRoom";
import Rag from "./Rag";
import Onboarding from "./Onboarding";
import MediaLibrary from "./MediaLibrary";
import KnowledgeBase from "./KnowledgeBase";
import CustomerMap from "./CustomerMap";
import DepartmentsMembers from "./DepartmentsMembers";
import TenantSettings from "./TenantSettings";
import AuditLog from "./AuditLog";
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
  | { page: "audit" };

const CRUMB: Record<Route["page"], string> = {
  warroom: "總覽儀表",
  rag: "智慧檢索",
  onboarding: "運作原理",
  media: "素材看板",
  km: "知識庫",
  map: "客戶地圖",
  depts: "部門 / 成員",
  config: "租戶設定",
  audit: "稽核記錄",
};

export default function App() {
  const [session, setSession] = useState<Session | null>(() => getSession());
  const [route, setRoute] = useState<Route>({ page: "warroom" });
  const [refreshing, setRefreshing] = useState(false);
  const [asOf, setAsOf] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (session) return;
    if (window.location.hash === "#demo") {
      login("gm@taiwanhomecare.demo", "demo123")
        .then(() => setSession(getSession()))
        .catch(() => undefined);
    }
  }, [session]);

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

  if (!session) return <Login onLogin={() => setSession(getSession())} />;

  const navActive = route.page === "warroom" ? "warroom" : route.page;
  const crumb = CRUMB[route.page];

  const onNav = (key: string) => {
    if (key === "warroom" || key === "signoff") setRoute({ page: "warroom" });
    else if (key === "rag" || key === "media" || key === "km" || key === "map"
      || key === "depts" || key === "config" || key === "audit") {
      setRoute({ page: key });
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
        onLogout={() => { logout(); setSession(null); }}
        onHelp={() => setRoute({ page: "onboarding" })}
      >
        {route.page === "warroom" && <WarRoom onRegister={onRegister} onLoadingChange={setRefreshing} />}
        {route.page === "rag" && <Rag />}
        {route.page === "onboarding" && <Onboarding onDone={() => setRoute({ page: "warroom" })} />}
        {route.page === "media" && <MediaLibrary />}
        {route.page === "km" && <KnowledgeBase />}
        {route.page === "map" && <CustomerMap />}
        {route.page === "depts" && <DepartmentsMembers />}
        {route.page === "config" && <TenantSettings />}
        {route.page === "audit" && <AuditLog />}
      </Shell>
    </ToastProvider>
  );
}
