import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

type Kind = "ok" | "warn" | "danger" | "info";
interface Item { id: number; msg: string; kind: Kind; time: string; }

const KIND_LABEL: Record<Kind, string> = { ok: "成功", warn: "警告", danger: "失敗", info: "通知" };

const ToastCtx = createContext<{ show: (msg: string, kind?: Kind) => void }>({ show: () => undefined });

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const show = useCallback((msg: string, kind: Kind = "info") => {
    const id = Date.now() + Math.random();
    const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    setItems((s) => [...s, { id, msg, kind, time }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "info" ? "" : t.kind}`}>
            <div className="toast-tstamp">
              <span className="time">{t.time}</span>
              <span className="type">{KIND_LABEL[t.kind]}</span>
            </div>
            <div className="toast-body">{t.msg}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
