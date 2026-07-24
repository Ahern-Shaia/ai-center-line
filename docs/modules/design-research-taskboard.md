# 設計研究 · 任務看板（Task Board / 簽核佇列）· §A5 競品分析

> 對應 `docs/frontend-design-principles.md` §A5（先研究≥3競品、向上設計）、§B0-OL（observability-light profile）。
> 對象元件：`web/src/warroom/TaskBoard.tsx`（待簽核 / 逾時警示 / 已簽核 三欄 Kanban）。
> 日期：2026-07-24 · 作者：ahern + Claude

---

## 0. 定位：我們不是「泛用 PM Kanban」，是「AI 抽取的簽核 triage 佇列」

我方看板的三欄 = **待簽核 / 逾時警示 / 已簽核**，使用者是工廠 GM／部門主管，動作是**逐筆審核 AI 從 LINE 對話抽出的任務並簽核**。這比 Trello/Asana 那種「團隊自建卡、拖動推進」更接近 **Datadog / PagerDuty 的告警 triage 佇列**：
- 卡片是**系統產生**的（AI 抽取），不是人手建。
- 主要動作是**分流 + 確認**（簽核），不是拖拽改狀態。
- 有**時效壓力**（逾時）與**信心度**（AI 抽得準不準）這兩個 PM 工具沒有的維度。

→ 對標要「PM 卡片語彙」+「告警佇列的 triage 邏輯」兩邊各取。

---

## 1. 競品逐一（§A5：做對 1–2 點 + 最弱 1 點）

| 競品 | 做對（吸收） | 最弱 / 做錯（避開） |
|---|---|---|
| **Linear** | ① 極致克制：卡面預設只顯必要屬性，其餘靠「display options」由使用者選顯 → 掃描效率高。② **優先級用 icon 形狀**（不只顏色）＝天生雙編碼、色盲友善。 | 對非重度使用者「太空」，密度要自己調；無「為何是這張卡」的來源脈絡。 |
| **Jira** | 卡片可配置、最多加 3 個欄位；用**色條/色塊**快速區分工作類型/優先級。 | 預設卡片**易雜亂**、企業味重；色塊濫用時反而降低可讀性。 |
| **Asana** | **兩層資訊**：卡面「快速視圖」+ 點開「深入」（如卡片正反面）——正是我們 card + drawer 的模型。強調 restraint。 | 狀態/類型過度依賴**顏色單編碼**；顏色一多就失去重點。 |
| **Datadog / PagerDuty**（告警佇列） | ① **嚴重度/緊急度是一等公民** + 自動分級。② 佇列顯 **duration / time-in-status（在此狀態多久）** 與 **responder（負責人）** → 一眼看出「哪個燒起來了、誰在處理」。 | 純表格密度高、沒分組時難掃；視覺偏冷硬。 |
| **Trello / Monday**（補充） | 標籤/狀態 pill 直覺；Monday 的彩色狀態一眼分流。 | 兩者都偏「顏色狂歡」，Monday 尤其 → 高密度後噪音大、AI 感/玩具感風險。 |

## 2. 共同弱點（大家都犯 → 我們修掉才叫「向上」）
1. **只靠顏色編碼**狀態/優先級（Asana/Monday/Jira 色塊）→ 色盲不友善、密度高時失焦。
2. **卡片過載**（第一大公認錯誤，Asana/Wrike/ClickUp 都點名）→「全部都顯眼＝沒有重點」。
3. **membership ≠ 嚴重度**：東西「在逾時欄」但沒說**逾時多久**，少了 triage 需要的量級（Datadog 有 duration，多數 PM 板沒有）。
4. **emoji / 玩具感裝飾**（很多輕量工具）→ 專業儀表板的反面（= 我方要去的「AI 感」病灶）。

---

## 3. 向上設計結論（贏過最強者 + 修共同弱點）

**贏過 Linear 的克制**：卡面預設只留 GM triage 需要的 5 樣 —— **摘要、分類、部門、指派、截止**；信心度、來源對話、時間戳一律進 drawer（Asana 兩層）。

**取 Datadog 的 triage 訊號**（PM 板沒有、我們的差異化）：
- **逾時欄顯「逾時 N 天」**（time-in-status 量級），不只是「在逾時欄」。
- **信心度只在「中/低」時出現**（＝需要人多看一眼的 triage flag），高信度不顯（是預設、逐卡標反成雜訊）。這把「AI confidence」變成佇列訊號——競品沒有的一手。

**修掉「只靠顏色」**（§A5 範例那條）：所有狀態一律**色 + 形 + 字**三重編碼：
- 逾時 = 玫瑰色 `●` + 「逾時 N 天」文字；待簽核 = 琥珀；已簽核 = emerald。
- 分類 = 中文文字 pill（非顏色）；指派/截止 = **muted SVG icon + 文字**（非 emoji）。

**去 emoji / 去玩具感**：`👤`/`📅` → 12px muted SVG；不用 Monday 式彩色狂歡。對齊 observability-light（Datadog light 的冷靜密度）。

---

## 4. 落地對照（對到 observability-light + TaskBoard.tsx）

| 決策 | 依據 | 現況（2026-07-24） |
|---|---|---|
| 分類顯中文 pill | §A5 修「顏色單編碼」+ 中文優先鐵則 | ✅ 已做（`shared/categoryLabel.ts`）|
| 指派/截止 muted SVG icon（非 emoji）| 去 AI 感 + observability-light 無裝飾 | ✅ 已做 |
| 信心度只在中/低顯（triage flag）| Datadog time-in-status 精神 + 克制 | ✅ 已做（`kb-conf`）|
| **逾時欄顯「逾時 N 天」** | Datadog duration；membership≠嚴重度 | ⬜ 待做（現只分欄，未顯量級）|
| **指派改「初字圓標 avatar」** | Linear/Jira avatar 更好掃 | ⬜ 待評估（現為 icon+名）|
| 狀態燈點 `●` + pill 雙軌 | §B0-OL 狀態語意 | ⬜ 欄用 tone，卡內可再強化 |
| 卡面 5 樣、其餘進 drawer | Linear 克制 + Asana 兩層 | ✅ 大致（drawer 已有）|

**下一步（若做整體重設計）**：先補「逾時 N 天」量級與（可選）avatar 初字圓標；欄首加 `●` 燈點；其餘維持克制。動手前依 §A10 截圖比對 Datadog light 的 alert list。

---

## 附錄 · 來源
- Linear Kanban / display options — toolstackpm.com, linear.app/docs/display-options
- Jira card customization（最多 3 欄、色碼）— support.atlassian.com/jira-software-cloud/docs/customize-cards
- Asana Kanban card best practices（兩層、restraint、勿過度用色）— asana.com/templates/kanban-card
- Datadog / PagerDuty 事件佇列（severity/duration/responder）— datadoghq.com/blog/incident-response-with-datadog, support.pagerduty.com/main/docs/incidents
- Kanban 卡片常見錯誤（過載、restraint）— wrike.com/kanban-guide/kanban-cards, clickup.com/blog/kanban-cards
