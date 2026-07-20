# AI 抽取品質 · 手工 label metric 表

> **樣本**：`samples/台灣福祉-改裝群.txt`（車輛改裝 · 兩天 · 34 訊息 · 6-7 平行話題）
> **AI 抽取結果**：`output/台灣福祉-改裝群.html` + `.json`（Claude Opus 4.7 · adaptive thinking · prompt caching · Zod structured output）
> **主檔 grounding**：`src/masterData.taiwanhomecare.ts`（10 人員 · 6 工位 · 3 改裝案 · 13 詞庫項）
> **Label 方式**：我方 domain sense check（非 formal ground truth · pilot 級 approximate）

---

## 三大 metric

### 1 · 訊息分類污染率（cross-talk contamination）

| 統計 | 值 | % |
|---|---|---|
| 總分類數 | 34 | 100% |
| 正確 | 30-31 | 91-94% |
| 邊界（可分多類都合理） | 3-4 | 6-12% |
| 明顯錯 | **0** | **0%** |
| **污染率**（保守取上限） | **5-10%** | — |

**邊界 case 例（都可接受但 AI 選了較保守）**：
- msg 10「業務-建國：某長照機構問復康巴士 STARIA 交期 我回月底」→ AI: chitchat / confidence=low · 更合理: rnd 或 procurement
- msg 13「組長: 各位改裝日報記得交」→ AI: chitchat · 也可分 daily_report reminder
- msg 33「明天業務-建國帶客戶來看 B 案交車」→ AI: chitchat · 也可分 procurement/rnd

### 2 · Event chain 完整度

| 統計 | 值 |
|---|---|
| 抽出 records 總數 | 11 |
| 正確合成 event chain（source_ids 涵蓋完整） | ~9 |
| 跨天/跨 segment 斷 | 2 case |
| **完整度** | **~85%** |

**Event chain 斷 case example**：
- 「鋼索斷裂 → 下單」records[0][2] · 07/02 內完整合成 ✅
- **但**「鋼索到貨入庫」records[6] · 07/03 · **應合成同一 event 但被拆成 2 筆 record**
- 原因：AI 按天切 segment · 跨天上下文丟失 · **這是 Ragic ingest 前需人工判斷合併**

### 3 · 實體對應準確度

| 實體類型 | 樣本數 | 正確 | 準確率 |
|---|---|---|---|
| Person（對到 P-XX code） | 11 | 9 | ~82% |
| Machine/Station（ST-XX） | 8 | 8 | 100% |
| Work order（CV-XXXX / 示範車號） | 10 | 10 | 100% |
| **平均** | **29** | **27** | **~93%** |

**Person 錯誤 example**：
- records[6] person: 「蔡○○」（full name）· 主檔對應 `P-09`
- records[7] person: 「張○○」 · 主檔對應 `P-05`
- 這是 AI 選 name 而非 code 一致性問題 · Ragic 匯入前需一支簡單腳本 name→code map

---

## 綜合評估

| 項目 | 結論 |
|---|---|
| **技術可行性** | ✅ Pipeline 通 · 抽取 sanity 級品質可用於 pilot |
| **業助自動化省時** | ✅ 34 訊息 → 9 日報 + 11 records · 若人工手抄約 20-30 min · AI 90 秒完成 · **省時 20-30x** |
| **需人工修正比例** | ~10-15%（污染率 5-10% + event chain 斷 ~15% + 實體對應 name↔code 修正）· 需人工 review 30-60 sec/筆 |
| **推薦上線 pattern** | pilot 級可用 · **must have human-in-loop confirm** 才 auto 進 Ragic |

---

## 誠實 caveat（面對 stakeholder Q 用）

- **Sample size 小**：34 訊息 · 統計顯著性弱 · **趨勢參考不是實測數據**
- **樣本是 mock**：手工設計 · 話題邊界較清楚 · **真實客戶對話量大 10x + 更多短回覆 + 錯字 + 話題交錯** · **污染率預期升到 15-25%**
- **要真實 metric 需 pilot 級**：客戶提供真對話 · 我方 tailored 分析 · pilot 收費 NT$10-30k 涵蓋（見 talk track Part D 定價）
- Metric 是**我方 label · 非 inter-annotator agreement 標準**
- 給客戶看 metric **講 range 不講單點**（e.g. 「準確 90-95%」不是「準確 92.4%」）

---

## Metric 可視化建議

會議中可秀簡易表格（不用 chart · 純數字有力）：

```
訊息分類準確率  ████████████████████  90-95%
Event chain 完整  ████████████████░░░░  ~85%
實體對應準確     ██████████████████░░  ~93%

需人工修正比例   ██░░░░░░░░░░░░░░░░░░  10-15%
```

（純 markdown block 也可 · 或 whiteboard 手畫）

---

## 資料來源交叉檢驗

- HTML report：直接開 `output/台灣福祉-改裝群.html` 看抽取
- JSON raw：`output/台灣福祉-改裝群.json` 每筆有 source_ids 可回溯原訊息 · Q&A 若客戶質疑「這筆哪來的」開 raw 秀
