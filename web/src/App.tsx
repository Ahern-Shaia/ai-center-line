import { useCallback, useEffect, useRef, useState } from "react";
import Login from "./Login";
import Shell from "./Shell";
import WarRoom from "./WarRoom";
import { getSession, logout, login, type Session } from "./api";
import { ToastProvider } from "./Toast";

export default function App() {
  const [session, setSession] = useState<Session | null>(() => getSession());
  const [active, setActive] = useState("warroom");
  const [refreshing, setRefreshing] = useState(false);
  const [asOf, setAsOf] = useState<string | undefined>(undefined);

  // #demo hash → auto login demo
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

  return (
    <ToastProvider>
      <Shell
        session={session}
        active={active}
        onNav={setActive}
        onRefresh={onRefresh}
        refreshing={refreshing}
        asOf={asOf}
        crumb={active === "warroom" ? "總覽儀表" : active === "signoff" ? "每日簽核" : undefined}
        onLogout={() => { logout(); setSession(null); }}
      >
        <WarRoom onRegister={onRegister} onLoadingChange={setRefreshing} />
      </Shell>
    </ToastProvider>
  );
}
