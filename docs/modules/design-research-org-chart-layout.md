# 設計研究 · 組織圖版型（寬淺樹怎麼排）

> 類型：**設計研究**（非落地模組）· 2026-08-21
> 起因：台灣福祉 prod 有 **13 個部門**，組織圖必須縮到 40% 才看得完，而 40% 時字已經讀不出來。
> 對象：`web/src/settings/depts-members/OrgGraph.tsx`、[`org-overview.md`](org-overview.md)
> 依 `docs/frontend-design-principles.md` §A5（動手前先研究 ≥3 競品）。

---

## 1. 這不是新問題，是舊假設被規模打破

[`org-overview.md`](org-overview.md) §5.2 的「三招」第三招寫得很清楚：

> ③ **部門多水平捲** —— 一部門一欄，加部門＝多一欄，不重算。解決「5/10 個部門排不下」

壓力測試的規格是 **5 部門 × 20 人**（`docs/mockup/org-graph-data-driven.html`）。
台灣福祉現在是 **13 個部門**，是當初驗收規格的 **2.6 倍**。

⭐ **招式沒壞** —— 它確實不重算、確實沒崩、確實可以水平捲。
壞的是「水平捲」這個解在 13 欄時退化：13 × (196 + 26) ≈ **2900px**，
一般筆電視窗放不下，只剩兩條路 —— 捲很久，或縮到 40%。

而 40% 的代價是**部門名 15px → 6px、成員名 11px → 4.4px**，等於看得到形狀、讀不到內容。

> 教訓不是「當初設計錯了」，是**驗收規格沒有跟著客戶長大**。
> 5 部門是我們自己設的數字，13 是客戶給的。這類「規模假設」值得在 doc 裡標成可驗證的門檻，
> 而不是寫在壓測檔名裡就算了。

---

## 2. 現況實測（台灣福祉 · 2026-08-21）

| 項目 | 值 |
|---|---|
| 部門數 | 13 |
| 成員數 | 11（分佈 0–4 人／部門，**7 個部門是 0 人**）|
| 樹深 | 公司 → 總經理室 → 部門 → 成員，**實質只有兩層有分支** |
| 版面寬 | 2900px（`.og-lanes` 是 `display:flex` **無 `flex-wrap`**）|
| 最長標籤 | 「技術工程部組長/生管/物控」「郁芬Sandra三爪❤️台灣福祉」「福祉集團-業務二部(含售服)」 |
| 欄寬 | 196px（`.og-lane`）—— 上面那些標籤全部塞不下，被擠成 2–3 行 |

⭐ **兩個關鍵特徵**：
1. **寬而淺** —— 13 個兄弟節點掛在同一個父節點下，深度只有 2
2. **標籤很長** —— LINE 顯示名混中英文、emoji、公司後綴，遠超過 196px

這兩點會直接決定該選哪種版型（§3）。

---

## 3. 四種版型 · 競品做法

### A · 上下樹 ＋ 水平捲（＝現況）

draw.io 的預設、絕大多數簡報用的版型。
draw.io 對「一個主管很多直屬」的建議是**把複雜分支拆到另一頁**，或用展開／收合，
**沒有**提供多欄分支之類的緊湊排法。

- ✅ 最眼熟、階層感最強
- ❌ 寬度隨部門數線性成長，13 個就爆掉
- ❌ 欄寬固定，長標籤被擠

### B · 部門換行（多列 / multi-column branch）

SmartDraw 明確建議：「若有數個職位向同一主管匯報，**multi-column branch** 是好的呈現方式」。
draw.io 的容器式版型也可以巢狀達到類似效果。

- ✅ 一行 CSS（`flex-wrap: wrap`）就能解「排不下」
- ❌ **沒解長標籤** —— 欄寬還是 196px
- ❌ 連線變醜：公司節點要拉到第二、三列，而 `bez()` 目前假設所有部門在同一水平線上

### C · 左右樹（橫向 · root 在左）

OneDirectory 把它列為四大版型之一，Lucid 也支援。關鍵句：
> 左右樹「**accommodates more text per block**（每個區塊容得下更多文字）」，
> 且「natural reading direction」。

- ✅ **寬淺樹轉 90 度就變成窄深樹**：13 欄 × 222px（2900px 寬）→ 13 列 × 約 56px（**約 730px 高**）
- ✅ **網頁本來就是垂直捲的** —— 把「要縮放才看得完」換成「滾兩下就到底」
- ✅ 節點可以給到 300–400px 寬，長標籤一行放得下
- ✅ 連線更單純：全部從左邊同一點分岔，不需要跨列曲線
- ❌ 階層感比上下樹弱（但我們只有兩層，本來就不靠版型表達深度）
- ❌ 是版型重做，不是加個屬性

### D · 逐層下鑽（drill-down）

Pingboard 等 HR SaaS 常見：一次只顯示一層，點節點往下鑽，麵包屑回上層。

- ✅ 任意規模都不爆
- ❌ **對兩層結構是殺雞用牛刀** —— 我們總共就兩層，下鑽一次就到底了
- ❌ 失去「一眼看完整個組織」的價值，而那正是這張圖存在的理由

---

## 4. 三個共通建議（不管選哪個版型都適用）

| 建議 | 出處 | 對我們的意義 |
|---|---|---|
| **分層顯示（progressive disclosure）** | organice：「hidden details, hover effects, and dropdowns」避免節點過載 | 縮小時只留部門卡、放大才顯示成員 —— 這是「縮到 40% 讀不到」的正解 |
| **搜尋／篩選** | organice：「加一個可依角色、姓名、部門、地點篩選的 filter」 | 13 個部門已經到了「用找的比用看的快」的規模 |
| **太大就拆成多張** | organice、SmartDraw 都提 | 我們還沒到那個規模，先不必 |

---

## 5. 結論與建議

**建議走 C（左右樹）＋ 分層顯示，不走 B。**

理由不是 C 比較好看，是**我們的兩個特徵剛好都指向它**：

| 我們的特徵 | B 解得了嗎 | C 解得了嗎 |
|---|---|---|
| 13 個兄弟節點排不下 | ✅ | ✅ |
| 標籤長、196px 塞不下 | ❌ | ✅ |
| 連線畫得乾淨 | ❌ 跨列曲線 | ✅ 同一點分岔 |

B 只解一半，而且把連線弄亂。C 兩個一起解。

### 代價（誠實列）

- 版型重做：`.og-lanes` 的 flex 方向、`draw()` 的座標邏輯、成員溢位排法都要改
- 階層感變弱 —— 但我們只有兩層，本來就不靠版型表達深度
- 需要重新出 mockup 給用戶過（R6）

### 順帶

C 若成立，**縮放功能就從「必要」降級成「加分」** ——
因為 100% 就看得完，不必縮到 40%。今天剛加的 Ctrl＋滾輪縮放仍然有用（放大看細節），
但不再是「不縮放就沒法用」。

---

## 6. 來源

- [The 4 Best Org Chart Layouts And How To Pick The Right One — OneDirectory](https://www.onedirectory.com/blog/the-best-org-chart-layouts-and-how-to-choose/)
- [Rules for Formatting Organizational Charts — SmartDraw](https://www.smartdraw.com/organizational-chart/organizational-chart-rules.htm)
- [Org Chart Design: UX/UI Best Practices — organice](https://www.organice.app/blog/org-chart-design-ux-ui-best-practices)
- [Org charts and tree diagrams — draw.io](https://www.drawio.com/docs/diagram-types/org-charts/)
- [d3-hierarchy · tree（Reingold–Tilford tidy tree）](https://d3js.org/d3-hierarchy/tree)
- prod 實況：台灣福祉組織圖截圖（2026-08-21）＋ `OrgGraph.tsx` / `styles.css` 現行實作

---

## 7. 變更紀錄

| 日期 | 版本 | 變更 |
|---|---|---|
| 2026-08-21 | v0.1 | 起於「13 部門要縮到 40% 才看得完」· 查證發現原設計壓測規格是 5 部門 · 研究四種版型 · 建議 C 左右樹 |
