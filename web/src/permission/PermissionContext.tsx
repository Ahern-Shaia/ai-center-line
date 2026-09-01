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
    /**
     * ⚠️⚠️ 2026-09-01 用戶回報「配置權限沒生效」：
     *    總經理在「權限管理」把員工加了 4 項權限、存檔成功（角色清單的數字也變了），
     *    但員工那邊側欄完全沒變 —— **連重新整理都沒用**。
     *
     *    原因就是這裡：舊版寫 `if (cached.size === 0) void refresh()`，
     *    也就是**只有快取空的時候才打 API**。而快取在 localStorage、TTL 5 分鐘，
     *    重新整理活得好好的 → 最多要等 5 分鐘才會生效。
     *    伺服器端其實有清快取（tenant-roles.service 存檔後 invalidateAll），
     *    卡住的是前端。
     *
     * ⭐ 快取的用意是「載入時先畫出東西、不要閃爍」，**不是「不要打 API」**。
     *    改成 stale-while-revalidate：先用快取渲染，然後**一定**重新驗證。
     */
    setPermissions(readCache(identity));
    void refresh();
    return () => { if (retryRef.current) clearTimeout(retryRef.current); };
  }, [identity, refresh]);

  /**
   * 分頁重新取得焦點時再驗一次 —— 這才真的兌現「改完立即生效」。
   *
   * 典型情境就是用戶回報的那個：左右兩個視窗，一邊改權限、一邊看效果。
   * 切回去的那一刻就該是新的，不該叫人重新整理。
   *
   * ⚠️ 節流 30 秒，避免頻繁切分頁時打爆 API
   *    （memory: react-context-value-stable-reference 那次 Toast 洗版的教訓）。
   */
  const lastFocusRef = useRef(0);
  useEffect(() => {
    if (!identity) return;
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFocusRef.current < 30_000) return;
      lastFocusRef.current = Date.now();
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
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
