# 台灣福祉客戶 demo material（2026-07-20）

> **場合**：60min 會議 · Q&A · sandy 業務窗口
> **目的**：客戶兩天內確認要不要繼續投入
> **戰略定位**：試水 · 市場投入前小成本驗證產品可行性

## 檔案索引

| # | 檔案 | 用途 | 何時用 |
|---|---|---|---|
| 01 | [`01-stakeholder-pre-read.md`](01-stakeholder-pre-read.md) | 一頁 stakeholder pre-read | **會議前 24 hr** 寄客戶 |
| 02 | [`02-metric-report.md`](02-metric-report.md) | 手工 label + 三大 metric 表 | 會議中 Value A 段引用 · 也可獨立 handoff |
| 03 | [`03-talk-track.md`](03-talk-track.md) | 60min demo talk track（Part 0-E） | 會議中 present 逐段 |
| 04 | [`04-qa-preparation.md`](04-qa-preparation.md) | 5 個預備 Q&A（抽錯 / PII / 換 ERP / 定價 / 時程） | 會議中 Part E Q&A 段 · 或 stakeholder 私下問 |
| 05 | [`05-sam-concept.md`](05-sam-concept.md) | SAM 8 模組概念 slide + 未來對話分析融合位置 | 會議中 Value C 段 |

## 使用順序

1. **會議前 24 hr** · 寄 `01-stakeholder-pre-read.md` 給客戶 stakeholder（含 sandy）
2. **會議前 1 hr** · 準備 `03-talk-track.md` 熟讀 · 開好 `output/台灣福祉-改裝群.html` 檔案
3. **會議中** · 照 `03-talk-track.md` 分段 walk through
4. **Q&A 段** · 用 `04-qa-preparation.md` 應答 · 未預備 Q 誠實答「回去查」不猜
5. **會議後 24 hr** · 寄 follow-up email · 附 `02-metric-report.md` + `05-sam-concept.md` 給決策者

## 引用 asset（現有 · 客戶 demo 用）

- **樣本原始檔**：`samples/台灣福祉-改裝群.txt`（客戶自己行業 · 車輛改裝場景 · 34 訊息 · 兩天）
- **AI 抽取結果 HTML**：`output/台灣福祉-改裝群.html`（會議中打開 · walk through）
- **原始 JSON**：`output/台灣福祉-改裝群.json`（Q&A 若客戶問細節可 open）
- **notify 已 SHIPPED（客戶已用）**：credibility 證明 · 講「我們已幫你們發 Ragic → LINE 通知在跑」

## 誠實原則

- Metric 是**手工 approximate**（sanity check 級） · 不是 formal ground truth · 講 range 不講單點數字（e.g. 「污染率 5-10%」不是「污染率 7.2%」）
- 若客戶問「真實客戶數據呢?」→ 誠實答「這是 mock demo · 真實 tailored 要 pilot 收費 NT$10-30k 我們產 report」
- 不承諾 SaaS 上線時程（EEA §5.12 完整版 3-6 個月 · 現階段是 pilot）

## 決策後 next steps

- 客戶 **yes** → 進 EEA §5.12 完整版 M0 design doc · 排 SAM 融合 · 3-6 個月工程
- 客戶 **no** → 不 sunk cost · 這批 material 給下個 pilot 客戶重用（改樣本 / 改主檔即可）
- 客戶 **wait** → follow up 每兩週 · 收集其他 pipeline 客戶（PDF §11 業務端十家）feedback
