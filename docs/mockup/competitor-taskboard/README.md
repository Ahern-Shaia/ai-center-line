# 任務看板競品視覺參考

> 供 `web/src/warroom/TaskBoard.tsx` 重設計參考。分析見 [`docs/modules/design-research-taskboard.md`](../../modules/design-research-taskboard.md)。
> 用途：內部設計對標（§A5「先鎖具體對標」）· 非再散布。下載日 2026-07-24。

## 已下載

| 檔案 | 競品 | 顯示什麼 | §A5 參考點 |
|---|---|---|---|
| `datadog-incident-response-1.png` | Datadog | Declare Incident 表單 · **Severity Level = 菱形 icon + 顏色 + 文字** segmented control（SEV-5 Minor…SEV-1 Critical）· 責任人 avatar · 屬性 tag chip | ⭐ **雙編碼（色+形+字）**範本 —— 我們信心度/優先級照此，不只靠顏色 |
| `datadog-incident-response-2.png` | Datadog | 事件管理主視圖（淺色高密度） | observability-light 密度/hairline 對標 |
| `datadog-incident-response-3.png` | Datadog | 事件流程/狀態視圖 | time-in-status / 狀態語意 |
| `datadog-related-incident.png` | Datadog | 關聯事件 | triage 上下文 |
| `datadog-followup.png` | Datadog | follow-up 追蹤項 | 後續任務呈現 |
| `linear-view-options.png` | Linear | view options / 屬性顯示切換 | ⭐ **克制**：預設少顯、由使用者選顯 |
| `kanban-sample-wikimedia.png` | 通用 | 典型 kanban 版面（Wikimedia, 開放授權） | 欄/卡基本結構基準 |

## 缺（marketing/docs 頁 lazy-load base64 或 402/403，curl 抓不到直接圖）
- **Jira / Asana / Monday / Trello / PagerDuty 的 board 產品截圖** —— 這幾家的官方頁圖片是懶載入或有防盜連。

> 需要補的話兩條路：① 你手動截圖丟進本資料夾（命名 `jira-board.png` 等）；② 給我可直接下載的圖片 URL，我 curl。
> 但實務上：我們 profile 是 observability-light，**Datadog（已抓）＋ Linear 的克制**才是主要對標；Monday/Trello 的「顏色狂歡」正是我們要避開的（避免抓來反被影響）。
