import { useEffect, useState } from "react";

// 根治「LINE 內建瀏覽器卡舊 SPA」：app 自我偵測部署新版 → 提示手動更新
//
// 為什麼需要：SPA 一旦載入就不再自己抓 index.html，webview 記憶體裡的舊版會一直活著，
// 純靠 HTTP 快取標頭救不了。這裡在執行中比對「目前跑的 entry bundle hash」與「線上最新
// index.html 引用的 hash」，不同就代表有新部署 → 跳橫幅讓使用者存好草稿再手動 reload。
// 手動（非自動）是刻意的：我的日報有未儲存草稿，不能自動 reload 清掉。

function currentEntryHash(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return el?.src.match(/index-([A-Za-z0-9_-]+)\.js/)?.[1] ?? null;
}

async function fetchLatestHash(): Promise<string | null> {
  // no-store + query buster · 避免 webview 連 index.html 都給快取
  const res = await fetch(`/index.html?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  const html = await res.text();
  return html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/)?.[1] ?? null;
}

export default function UpdateBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // dev 無 hashed bundle（vite 直接吃 /src）· 只在 prod build 啟用
    if (!import.meta.env.PROD) return;
    const current = currentEntryHash();
    if (!current) return;

    let stopped = false;
    const check = async () => {
      if (stopped || document.hidden) return;
      try {
        const latest = await fetchLatestHash();
        if (latest && latest !== current) {
          setShow(true);
          stopped = true; // 偵測到就停 · 等使用者更新
        }
      } catch {
        // 網路/離線失敗忽略 · 下次再試
      }
    };

    void check();
    const onVisible = () => { if (!document.hidden) void check(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void check(), 5 * 60 * 1000);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);

  if (!show) return null;

  return (
    <div role="status" className="update-banner">
      <span className="update-banner-text">已有新版本 · 更新後即可正常操作</span>
      <button className="btn btn-primary small" onClick={() => window.location.reload()}>立即更新</button>
      <button className="btn small" onClick={() => setShow(false)} aria-label="稍後再更新">稍後</button>
    </div>
  );
}
