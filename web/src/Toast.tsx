import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

type Kind = "ok" | "warn" | "danger" | "info";
interface Item { id: number; msg: string; kind: Kind; }

const ToastCtx = createContext<{ show: (msg: string, kind?: Kind) => void }>({ show: () => undefined });

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const show = useCallback((msg: string, kind: Kind = "info") => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, msg, kind }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind === "info" ? "" : t.kind}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
