import { useCallback, useEffect, useRef, useState } from "react";
import Login from "./Login";
import Shell from "./Shell";
import WarRoom from "./WarRoom";
import Rag from "./Rag";
import Onboarding from "./Onboarding";
import { getSession, logout, login, type Session } from "./api";
import { ToastProvider } from "./Toast";

type Route =
  | { page: "warroom" }
  | { page: "rag" }
  | { page: "onboarding" };

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

  const navActive = route.page === "rag" ? "rag" : route.page === "onboarding" ? "onboarding" : "warroom";
  const crumb =
    route.page === "warroom" ? "總覽儀表"
    : route.page === "rag" ? "智慧檢索"
    : route.page === "onboarding" ? "運作原理"
    : "總覽";

  const onNav = (key: string) => {
    if (key === "warroom" || key === "signoff") setRoute({ page: "warroom" });
    else if (key === "rag") setRoute({ page: "rag" });
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
      </Shell>
    </ToastProvider>
  );
}
