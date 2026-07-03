# 台灣福祉 AI 戰情室 — 設計系統（blueprint）

> 前端視覺 UI/UX 規範的**文字/token 版**，供工程實作參考。視覺活樣式指南見 `docs/mockup/品牌視覺規範-bp.png`（由 `renderBrandGuideBP()` 產生）。**Token 唯一真實來源＝`src/warroom/render.ts` 的 `BP_CSS`**；本文與之對應，改 token 以程式碼為準。
> Profile：`blueprint`（見 `frontend-design-principles.md` §B0-BP）。

---

## 1. 識別 & 原則

**視覺隱喻＝工程製圖／改裝圖紙**——取自客戶（福祉車改裝廠）自己的世界；介面像一張活的技術圖面，非通用後台。

| # | 原則 | 說明 |
|---|---|---|
| P1 | 可溯源鐵律 | 畫面每個數字掛來源表名、可當場反推；不放純裝飾示意數字 |
| P2 | 誠實 ＞ 好看 | 刻意不美化信心度（低值是加分）；人未簽核前一律標草稿 |
| P3 | 狀態雙編碼 | 狀態＝色＋文字/mono tag，不只靠顏色（WCAG 1.4.1） |
| P4 | 冷工程調性 | 一致冷淺色、零/極小圓角、規線與留白定深度，不靠 glow/重陰影 |

---

## 2. 色彩

單主色（藍圖藍）＋單 accent（琥珀，僅告警）；冷石板中性三階。狀態色皆須配文字/形狀。

| Token | Hex | 角色 / 用途 |
|---|---|---|
| `--paper` | `#EDF0F3` | 頁底（雙尺度格線畫在此） |
| `--sheet` | `#F8FAFB` | 主面板 / 卡 |
| `--well` | `#E8ECF0` | 次區塊 / hover 底 |
| `--line` | `#CFD7DF` | 邊框 / hairline |
| `--line-2` | `#E2E8ED` | 更淡分隔 |
| `--ink` | `#18242F` | 主文字 |
| `--ink-2` | `#4E5C67` | 次文字 |
| `--ink-3` | `#85929D` | 輔助 / mono 標註 |
| `--blue`（主色） | `#2C588A` | 品牌 / 連結 / 儀表填充 |
| `--blue-2` | `#3D71AC` | 主色 hover / 次填充 |
| `--blue-tint` | `#E3EBF4` | 淡底 / 選中 / 表名 chip |
| `--amber`（accent） | `#B0741A` | 告警 / 重點（唯一 accent，克制用） |
| `--ok`（綠燈） | `#2C7A6B` | 正常 |
| `--warn`（黃燈） | `#B0741A` | 待確認未逾時 |
| `--danger`（紅燈） | `#BE4630` | 逾時 / 異常 |

---

## 3. 字體

| 角色 | 字體 | 規格 |
|---|---|---|
| 標題 / 內文 | **IBM Plex Sans** | H1 31/600/-.015em；H2 15/600；body 14–15.5/400；label 10/500/.2em、UPPERCASE |
| 數據 / 代碼 / 標註 / 表頭 | **IBM Plex Mono** | 大數字 19–23/600、tabular-nums；工單號/時間戳/表名/tag |
| 中文 | PingFang TC / 思源黑體 | 承接 Latin |

- **不用 serif**（serif 屬編輯/年報語彙，非工程圖）。
- **地端須 self-host IBM Plex（woff2）**，不可依賴 Google Fonts CDN（見開發文件技術棧）。

---

## 4. 燈號 & 狀態（色＋文字雙編碼）

- **燈號**：綠 `--ok`（正常處理中）／黃 `--warn`（待確認未逾時）／紅 `--danger`（逾時/異常）／灰 `--ink-3`（待機/未啟）。圓點 + 外圈淡光。
- **pill（outlined，框線非填底）**：`已簽核`(ok) / `待簽核`(warn) / `逾時警示`(danger) / `已同步 RAG`(blue) / `洽談中`(ghost)。mono、1px currentColor 框。
- **信心 tag**：`▍HIGH`(ok) / `▍MED`(warn) / `▍LOW`(danger)，mono。
- 一律**色＋文字**，不可只用顏色。

---

## 5. 元件

| 元件 | 說明 |
|---|---|
| masthead | 淺 sheet 底 + 藍圖藍 2px 下框；wordmark + mono 角色/時間 |
| title block | 工程圖標題塊：大標 + mono meta 格（日期/產線/檢視/狀態）+ dwg 行（SCALE/SHEET/REV） |
| registration 角落刻度 | sheet 四角 ⌐ 藍圖藍刻度框（signature） |
| section head | `§NN` mono 編號 + 標題 + 右側 mono 註 + hairline |
| **量測刻度儀表**（signature） | bullet bar + 四分格線 + 共用 0–25–50–75–100 尺規（tick）；大數字 mono |
| register 列 | mono 兩位索引 + 燈點 + 名稱 + 表名 chip + 狀態 + 右對齊時間；hover 淡底 |
| sign-off table | mono UPPERCASE 表頭、1.5px 底線；outlined pill + 信心 tag；低信心列琥珀底 + 左紅條 |
| ops 條 | 分欄 mono 大數字 + label + 右側來源表名 |
| 按鈕 | ghost（框線，hover 淡底）/ primary（藍圖藍填色，hover blue-2、press translateY） |
| 線性圖示 | 自訂 SVG，一致 stroke 1.55；search/csv/image/video/pdf/chat/arrow |
| 卡片原則 | 用**規線與留白**分區，非「框+陰影+白底」的通用卡；elevation 只在需要層級時用 |

---

## 6. Token（CSS 變數；唯一真實來源 `BP_CSS`）

| 類 | 值 |
|---|---|
| 色 | 見 §2 |
| radius | 0–2px（製圖感，零/極小圓角） |
| grid | 細 28px + 粗 84px 雙尺度工程紙格線；grain 疊層 opacity .028（fixed/pointer-events:none） |
| shadow | tinted ink（非純黑）+ 外白 6px（模擬紙浮起） |
| spacing | section 內距 26px、列距 8–12px；bottom padding 略大於 top（光學） |
| `--ease` | `cubic-bezier(.32,.72,0,1)`（統一過場曲線） |
| font | `--gr` IBM Plex Sans；`--mono` IBM Plex Mono |

---

## 7. 微動效（順暢舒適）

原則：**只動 `opacity` / `transform`（不抖版）、統一 `--ease`、短、尊重 `prefers-reduced-motion`**。

| 互動 | 效果 | 時長 / 曲線 |
|---|---|---|
| hover · 列/表列 | 背景淡移入 `--well`/`--blue-tint`，只動 background | 150ms · ease |
| press · 按鈕 | `translateY(1px)` 模擬實體按壓 | 180ms · cubic-bezier |
| focus · 鍵盤 | `:focus-visible` 藍圖藍 2px ring + offset | outline |
| meter 填充 | 儀表 width 0→值，載入平順填充 | 600–800ms · ease |
| enter · 進場 | opacity + translateY 淡上，錯開 stagger，不一次全彈出 | 150–250ms |
| reduced-motion | `prefers-reduced-motion` 時只 fade、不位移，全域尊重 | media query |

---

*對應：`frontend-design-principles.md` §B0-BP（profile 鎖定）、`docs/modules/design-research-warroom.md`（v9/v10 研究）、`src/warroom/render.ts`（BP_CSS token、各視角 renderer）。改視覺改 `render.ts`，本文同步。*
