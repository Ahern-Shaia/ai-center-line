# 部門日報前端設計研究（A5：先研究、再設計 · 站在巨人的肩膀）

> 狀態：✅ **M0 定案（方向 C）· M1 前端完成**（2026-08-01）· 待 push
> 觸發：用戶回饋「部門日報這頁**雜亂冗長**」。實測截圖 21 筆裡 **12 筆是「當日無內容（項數 0）」**——
> 每人每天都補一列空的，把真正有內容的 ~9 筆日報淹掉。
>
> 適用 profile：`observability-light`（CLAUDE.md R16 鎖定；定義見 `frontend-design-principles.md` §B0-OL）。
> 現況元件：`web/src/personal-report/TeamDailyReport.tsx`（166 行 · `.dm-table` · 點列展開 `.pdr-item`）。
> 相關：`warroom/DailyLog.tsx`（群組日誌 · 同 empty-state pattern）、`design-research-warroom.md`（同專案研究先例）。

---

## 0. 問題定性（不是「表格醜」，是「訊噪比低」）

現況：後端為**每個成員 × 每一天**都建一筆 `personal_daily_report`，沒回報的是 `status='empty'`。
前端 `TeamDailyReport` 把它們**全部平鋪**成表格列 → 12/21 是空列。

這不是樣式問題，是**資訊架構問題**：把「沒發生的事」當成一等資料渲染。
一流工具的共通做法正好相反 —— 見 §1。

---

## 1. 參考對象（§A5 · ≥3 真實產品 · 站在巨人的肩膀）

### 1. Linear — issue / activity list（標竿：密度 + 永不空列）
- **從不為「沒發生」畫列**：list 只有真的存在的 issue；沒有 activity 的人不佔一列。
- **group-by + 收合**：可依 assignee/status/date 分組，組頭一行、可整組收合，count 放組頭。
- **密度切換**（comfortable / compact），鍵盤導覽，hairline 分隔，語意色靠小圓點不靠整列上色。
- 偷這幾點：**空的不渲染**、**分組把同類收成一行組頭**、**count 放組頭不佔列**。

### 2. Datadog — Logs / Events list（標竿：噪音聚合 + facet 過濾）
- **左側 facets**（service / status / host）做**過濾**，主區只顯示命中的；預設就濾掉噪音等級。
- **"N similar events" 摺疊**：把重複/低訊號事件收成一行「還有 N 筆」，要看才展開。
- severity 用**左緣色條 + pill**雙編碼，不整列塗色。
- 偷這幾點：**預設過濾低訊號**、**低訊號聚合成一行**、**左緣色條 + pill 語意**。

### 3. Metabase — audit / tabular admin（標竿：淺色高密度表格的手藝）
- sticky thead、`tabular-nums` 對齊數字、pill badge 語意色、row hover well 底。
- **empty 與 zero 分明**：沒資料給明確 empty-state，不是空白列。
- 偷這幾點：**sticky 表頭 + tabular 數字 + pill**、**empty-state 有文案不留白列**。

### 4. GitHub — activity feed（標竿：缺席用聚合語言，不用列）
- 「**X 與另外 N 人**做了 Y」把長尾收成一句；沒動作的人根本不出現。
- 偷這點：**缺席 / 長尾用一句聚合句**（「另有 N 位當日無回報」），不是 N 條列。

> **共通洞察（giant's shoulder）**：**沒有一個一流工具會為「今天沒回報」渲染一列。**
> 缺席是「**聚合成一行 + 可選 filter**」，不是 padding。訊號（有內容的日報）才佔列。

---

## 2. 向上設計（以 observability-light 落地上面四點）

### 2.1 預設只顯示「有內容」的日報
- 預設 filter＝**項數 > 0 或 狀態 ∈ {sent, confirmed, draft}**（即真的有寫東西的）。
- `status='empty'` 的**不進主列表**。截圖那 12 空列直接消失，剩 ~9 筆真訊號。

### 2.2 缺席收成一行聚合（GitHub 式，保留「誰沒回報」的管理價值）
- 主列表下方一行 well 卡：**「這段期間另有 N 人次當日無回報」** + `展開` →
  展開後才列出（可再按人/日聚合），預設收起。管理者要追「誰沒交」仍查得到，但不佔畫面。

### 2.3 分段過濾 + 分組（Linear/Datadog 式）
- **Segmented control**：`有內容(預設)` / `未回報` / `全部`（延用 `.btn`＋`btn-primary` 慣例，同「近 7/30 天」）。
- tenant_admin 多一個**部門下拉**（延用 project 既有 `StyledSelect`，見 memory `feedback_grep_ui_components_before_writing`）；group_owner 不顯示（RLS 已鎖單部門）。
- 預設 **group-by 日期**：日期當組頭（`2026-07-29 · 3 筆`），成員列在其下；組頭可收合。

### 2.4 列本身：observability-light token（不重排版而已，是換密度與語意）
- 狀態改**● 燈點 + pill** 雙編碼（綠=已送出 / 琥珀=待送出 / 灰=草稿）；`tabular-nums` 對齊項數。
- hairline 分隔、hover well 底、`shadow-sm`；圓角 6px；body 14px、metadata 12-13px（**最小 12px**，§B0-OL avoid-list）。
- **一行預覽**：未展開時，在標題列尾顯示首個事項的**灰階摘要**（Linear 式 preview），掃視就知道大概。

### 2.5 §A6 所有狀態（不只 happy path）
| 狀態 | 呈現 |
|---|---|
| loading | skeleton 列（非「載入中…」純文字） |
| 有內容 | 分組列表（§2.1-2.4） |
| 全部都是空（過濾後 0） | empty-state：「這段期間部門成員都沒有送出有內容的日報」+ 提示切「未回報」看誰沒交 |
| error | 明確錯誤卡 + 重試（非 toast 一閃即逝） |
| 展開單筆無項目 | 「這份日報沒有項目」（現況已有，保留） |

### 2.6 compact token plan（§C2 · 沿用 observability-light，不發明）
- canvas `#F7F8FA` / surface `#FFF` / well `#F1F3F6` / hairline `#E5E7EB`
- 墨 `#111827` / `#4B5563` / `#6B7280`；primary 靛藍 `#4F46E5`
- 語意：emerald `#059669`（已送出）/ amber `#D97706`（待送出）/ 灰（草稿·無內容）
- 圓角 6px；`font-variant-numeric: tabular-nums`；spacing 用 `gap-*`（禁硬編 hex，§A2）

---

## 3. 三個版面方向（§A1 對標 · 請用戶選一個）

> 都在 observability-light 內、都做到「空列不佔畫面」，差在**主結構**。詳細 ASCII 見對話中的選項預覽。

- **方向 A：分組時間軸（對標 Linear）** — 日期組頭 + 其下成員列 + 底部「N 人未回報」聚合。推薦。
- **方向 B：facet 過濾表（對標 Datadog Logs）** — 左窄 facet（部門/狀態/人）+ 右主表，重過濾。
- **方向 C：精簡表格（對標 Metabase）** — 維持單一表格，只加預設過濾空列 + segmented + pill 燈點（改動最小）。

---

## 4. 開放問題（OQ-DR-N · 待裁定）

> ✅ **2026-08-01 裁定**：OQ-DR-1＝**C 精簡表格**（改動最小、最快上線）；OQ-DR-2 隱藏+底部聚合；OQ-DR-3/4/5 採建議。M1 已實作（`TeamDailyReport.tsx`）。三方向 mockup 存 `docs/mockup/daily-report-{A-timeline,B-facet,C-table}.html`。

| # | 問題 | 裁定 |
|---|---|---|
| ~~**OQ-DR-1**~~ | 三個版面方向選哪個？ | ✅ **C 精簡表格**（對標 Metabase · 維持單表、動最少、風險最低）· A/B mockup 留檔備日後升級 |
| **OQ-DR-2** | 空日報預設「隱藏」還是「聚合成一行」？ | **隱藏 + 底部聚合一行**（管理者仍查得到誰沒交，但不佔畫面） |
| **OQ-DR-3** | 這次 scope 只做 `部門日報`，還是連 `群組日誌(DailyLog)` 一起對齊？ | **先只做部門日報**；同 pattern 記進 backlog，驗證後再套群組日誌 |
| **OQ-DR-4** | 需要後端配合嗎（例：query 支援 `hasContent` 過濾、聚合 count）？ | **前端先做**（現有 API 已回全部，前端過濾即可）；量大再談後端分頁/聚合 |
| **OQ-DR-5** | 展開後要不要同時把 warroom 群組日誌的「原始訊息展開」也統一？ | 否 · 屬 OQ-DR-3 的 backlog，不在本 scope |

---

## 5. 里程碑

| 里程碑 | 內容 |
|---|---|
| **M0** ✅ | 本研究 + 三方向 mockup + 方向選定（C）|
| **M1** ✅ | 重構 `TeamDailyReport.tsx`（前端 only）：預設過濾空列 + `未回報/全部` segmented + 部門 StyledSelect + `.nc-pill` 狀態 + tabular 項數 + 底部聚合行 + §A6 五態（loading/有內容/過濾後空/整體空/展開無項目）· 複用 `.dm-table`/`.nc-pill`/`.btn`/`StyledSelect`/`.dm-info-note` · §A10 已對 real styles.css 截圖驗 · web tsc 綠 |
| **M2** | 上 dev/prod 看真實資料回看（§A10）+ 微調密度（mobile 響應） |
| **M3** | （依 OQ-DR-3）同 pattern 對齊 `DailyLog.tsx` 群組日誌 |

---

## 6. 失效場景反思（FMEA-lite · 前端）

| # | 路徑 | 失效 | 嚴重 | 緩解 |
|---|---|---|---|---|
| F-1 | 預設過濾 | 過濾把「有內容但狀態異常」的也藏了 | P1 | 過濾條件用「項數>0 OR 狀態∈{sent,confirmed,draft}」聯集，不是單看狀態 |
| F-2 | 缺席聚合 | 聚合行讓管理者以為「沒人沒交」 | P1 | 聚合行永遠顯示 count（0 才不顯示）；文案明確「N 人次未回報 · 展開」 |
| F-3 | scope | 前端過濾誤讓人以為資料被刪 | P2 | segmented「全部」隨手可回；文案講「隱藏空日報」非「無資料」 |
| F-4 | a11y | 燈點只用顏色 | P1 | §A3／§B0-OL：色 + pill 文字雙編碼；segmented 有 aria-pressed |
| F-5 | RLS | 前端加部門 filter 誤當權限邊界 | P1 | 部門 filter 只是視覺；scope 仍靠後端 RLS（現況註解已載明），不在前端 scope |

---

## 7. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-01 | v0.1 | M0 首版 · 觸發＝部門日報「雜亂冗長」（12/21 空列）· §A5 研究 Linear/Datadog Logs/Metabase/GitHub 四參照 · 核心洞察「一流工具不為缺席畫列」· observability-light 落地 · 三版面方向（A 分組時間軸／B facet 表／C 精簡表格）· OQ-DR-1..5 待裁定 | ahern + Claude Code |
