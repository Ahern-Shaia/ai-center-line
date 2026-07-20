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
import ConversationAnalysisUpload from "./ConversationAnalysisUpload";
import ConversationAnalysisList from "./ConversationAnalysisList";
import ConversationAnalysisDetail from "./ConversationAnalysisDetail";
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
  | { page: "convo-list" }
  | { page: "convo-upload" }
  | { page: "convo-detail"; uploadId: number };

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
  "convo-list": "AI 對話分析",
  "convo-upload": "AI 對話分析",
  "convo-detail": "AI 對話分析",
};

const PAGE_TITLE: Record<Route["page"], string> = {
  warroom: "總覽儀表",
  rag: "智慧檢索",
  onboarding: "運作原理",
  media: "素材看板",
  km: "知識庫",
  map: "客戶地圖",
  depts: "部門 / 成員",
  config: "租戶設定",
  audit: "稽核記錄",
  "convo-list": "分析列表",
  "convo-upload": "上傳新對話",
  "convo-detail": "分析詳情",
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

  useEffect(() => {
    document.title = `${PAGE_TITLE[route.page]} · aiproot 戰情室`;
  }, [route.page]);

  if (!session) return <Login onLogin={() => setSession(getSession())} />;

  const navActive = route.page === "warroom" ? "warroom" : route.page;
  const crumb = CRUMB[route.page];

  const onNav = (key: string) => {
    if (key === "warroom" || key === "signoff") setRoute({ page: "warroom" });
    else if (key === "rag" || key === "media" || key === "km" || key === "map"
      || key === "depts" || key === "config" || key === "audit") {
      setRoute({ page: key });
    } else if (key === "convo-list" || key === "convo-upload") {
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
        </div>
      </Shell>
    </ToastProvider>
  );
}
