import { useT } from "../i18n/useT";
/**
 * 「這一頁還是示範資料」的橫幅。
 *
 * ⚠️ 為什麼需要它：這兩頁在 2026-07-27 被下架，理由是不可在客戶畫面上放
 * 做不到的東西；07-29 掛回來只給平台側看。但**我們自己也會忘記** ——
 * 過幾週再打開，畫面看起來完全正常（問一句話就有帶引用的答案），
 * 很容易把它當成已經接好的功能拿去對客戶承諾。
 *
 * 所以這行字是寫給我們自己看的，不是寫給客戶的。
 */
export default function DemoDataBanner({ doc }: { doc: string }) {
  const tr = useT();
  return (
    <div className="demo-banner">
      {tr("demo.banner")}
      <span className="demo-banner-doc">{tr("demo.doc")}{doc}</span>
    </div>
  );
}
