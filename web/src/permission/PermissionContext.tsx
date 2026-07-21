import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getMyPermissions, getSession, ApiError } from "../api";

// Permission Context · 登入後 GET /me/permissions · cache 於 memory + localStorage
// TTL 5 分鐘 · 對照 backend cache

const CACHE_KEY = "acl.perms";
const CACHE_TS_KEY = "acl.perms_ts";
const TTL_MS = 5 * 60 * 1000;

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

export function PermissionProvider({ children }: { children: ReactNode }) {
  const [permissions, setPermissions] = useState<Set<string>>(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      const ts = Number(localStorage.getItem(CACHE_TS_KEY) ?? 0);
      if (cached && Date.now() - ts < TTL_MS) {
        return new Set(JSON.parse(cached) as string[]);
      }
    } catch {
      // ignore parse errors
    }
    return new Set();
  });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!getSession()) return;
    setLoading(true);
    try {
      const res = await getMyPermissions();
      const set = new Set(res.permissions);
      setPermissions(set);
      localStorage.setItem(CACHE_KEY, JSON.stringify(res.permissions));
      localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
    } catch (err) {
      // 401 已由 api.ts 統一 logout · 這裡不需處理
      if (!(err instanceof ApiError && err.status === 401)) {
        console.warn("[permissions] refresh failed", err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const session = getSession();
    if (!session) return;
    const ts = Number(localStorage.getItem(CACHE_TS_KEY) ?? 0);
    if (Date.now() - ts >= TTL_MS || permissions.size === 0) {
      refresh();
    }
  }, [refresh, permissions.size]);

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
}
