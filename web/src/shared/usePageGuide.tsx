import { useState } from "react";
import { PAGE_GUIDES } from "./pageGuides";

// 頁面用途說明 · 對照 docs/mockup/page-guide.html
//
// ⭐⭐ **永遠不自動展開。** 量過：面板高 218px ≈ 1080p 筆電可視高度的四分之一。
//    自動展開有三個問題：
//      ① 「是不是新租戶」要打 API 才知道 → 一定是畫完之後才展開 → **內容會往下跳 218px**，
//         使用者正要點的東西會位移（會點錯的那種，不只是變高）
//      ② 每天在用的人（主管每天 3 分鐘）純損失
//      ③ 跟「空狀態當老師」重複 —— 新客戶第一次進來每頁本來就是空的，
//         那個位置的空狀態已經在講「這頁是什麼、東西從哪來」了
//    所以：按鈕常駐、面板只在點擊後出現。這顆按鈕主要是給**要對別人講解的人**用的工具。
//
// ⚠️ 不用彈窗（modal / popover）：使用者的場景是「邊講邊指畫面」，蓋住內容就沒法指。
//
// 用法（toggle 放進 h1、panel 放在 pane-hdr 之後）：
//   const guide = usePageGuide("task-board");
//   <div className="pane-hdr"><div><h1>任務看板{guide.toggle}</h1>…</div></div>
//   {guide.panel}

export function usePageGuide(id: keyof typeof PAGE_GUIDES | string) {
  const [open, setOpen] = useState(false);
  const g = PAGE_GUIDES[id];
  if (!g) return { toggle: null, panel: null };

  const toggle = (
    <button
      type="button"
      className="pg-toggle"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      {open ? "▾ 收起說明" : "這一頁做什麼？"}
    </button>
  );

  const row = (k: string, v: string) => (
    <div className="pg-row">
      <span className="pg-k">{k}</span>
      <span className="pg-v">{v}</span>
    </div>
  );

  const panel = open ? (
    <div className="pg-panel">
      {row("回答什麼問題", g.q)}
      {row("資料從哪來", g.from)}
      {row("你通常會做什麼", g.todo)}
      {row("誰看得到", g.who)}
      <div className="pg-foot">
        <button type="button" className="pg-hide" onClick={() => setOpen(false)}>收起</button>
        {/* 完整流程走右上角那顆 ?（Onboarding）· 這裡只提示，不另接一套導覽 */}
        <span className="pg-more">想看完整運作流程 → 右上角的「?」</span>
      </div>
    </div>
  ) : null;

  return { toggle, panel };
}
