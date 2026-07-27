import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getMyPermissions, getToken, ApiError, onTokenChange } from "../api";

// Permission Context · 登入後 GET /me/permissions · cache 於 memory + localStorage
// TTL 5 分鐘 · 對照 backend cache
//
// 兩個踩過的坑，改這支之前先讀：
// 1. 本 Provider 掛在 App 之上（main.tsx），包含登入頁。登入是 App 內部 setState，
//    Provider 不會重新執行 effect —— 所以必須靠 onTokenChange 訊號才知道身分變了。
//    沒有它的話：登入後權限永遠是空的，所有有 perm 的側欄項目都不見，要手動重新整理才會好。
// 2. 快取必須綁身分。key 若是全域的，換帳號登入會沿用前一個人的權限（多給或少給都危險）。

const CACHE_KEY = "acl.perms";
const CACHE_TS_KEY = "acl.perms_ts";
const CACHE_ID_KEY = "acl.perms_id";
const TTL_MS = 5 * 60 * 1000;
const RETRY_MS = 3000;

// 身分指紋：token 換了就是換了身分（含同一人重新登入 · token 內容必不同）
function identityOf(token: string | null): string | null {
  return token ? token.slice(-32) : null;
}

interface PermCtxValue {
  permissions: Set<string>;
  has: (perm: string) => boolean;
  hasAny: (...perms: string[]) => boolean;
  refresh: () => Promise<void>;
  loading: boolean;
}

const PermCtx = createContext<PermCtxValue>({
  permissions: new Set(),
  has: () => false,
  hasAny: () => false,
  refresh: async () => undefined,
  loading: false,
});

export function usePermissions() {
  return useContext(PermCtx);
}

function readCache(identity: string | null): Set<string> {
  if (!identity) return new Set();
  try {
    if (localStorage.getItem(CACHE_ID_KEY) !== identity) return new Set();   // 別人的快取，不能用
    const ts = Number(localStorage.getItem(CACHE_TS_KEY) ?? 0);
    if (Date.now() - ts >= TTL_MS) return new Set();
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? new Set(JSON.parse(cached) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

export function PermissionProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<string | null>(() => identityOf(getToken()));
  const [permissions, setPermissions] = useState<Set<string>>(() => readCache(identityOf(getToken())));
  const [loading, setLoading] = useState(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 登入 / 登出 / 換帳號 → token 變 → 重新判定身分
  useEffect(() => onTokenChange(() => setIdentity(identityOf(getToken()))), []);

  const refresh = useCallback(async () => {
    const id = identityOf(getToken());
    if (!id) return;
    setLoading(true);
    try {
      const res = await getMyPermissions();
      setPermissions(new Set(res.permissions));
      localStorage.setItem(CACHE_KEY, JSON.stringify(res.permissions));
      localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
      localStorage.setItem(CACHE_ID_KEY, id);
    } catch (err) {
      // 401 已由 api.ts 統一 logout · 這裡不需處理
      if (!(err instanceof ApiError && err.status === 401)) {
        console.warn("[permissions] refresh failed", err);
        // 失敗要自己重試。原本靠 permissions.size 當 effect 依賴，
        // 抓失敗時 size 一直是 0、依賴沒變 → effect 不會再跑 → 權限永遠空的。
        if (retryRef.current) clearTimeout(retryRef.current);
        retryRef.current = setTimeout(() => { void refresh(); }, RETRY_MS);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    if (!identity) {
      setPermissions(new Set());
      clearPermissionCache();
      return;
    }
    const cached = readCache(identity);
    setPermissions(cached);
    if (cached.size === 0) void refresh();     // 沒有可信快取才打 API
    return () => { if (retryRef.current) clearTimeout(retryRef.current); };
  }, [identity, refresh]);

  const value = useMemo<PermCtxValue>(() => ({
    permissions,
    has: (perm: string) => permissions.has(perm),
    hasAny: (...perms: string[]) => perms.some((p) => permissions.has(p)),
    refresh,
    loading,
  }), [permissions, refresh, loading]);

  return <PermCtx.Provider value={value}>{children}</PermCtx.Provider>;
}

export function clearPermissionCache() {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(CACHE_TS_KEY);
  localStorage.removeItem(CACHE_ID_KEY);
}
