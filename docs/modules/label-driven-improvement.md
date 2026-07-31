# label-driven-improvement · 用「標對錯」回饋改進 AI 抽取

> ✅ **狀態：M1+M2 SHIPPED（本地）v0.2（2026-08-01）· OQ 全採建議 · M3（LLM 重跑 eval）延後**
>
> 用戶「全採建議、一氣呵成」→ OQ-LFB-1..5 全採 A（OQ-3 取「最後標的贏」＝現況 upsert）。
> ⚠️ 現實檢查：**prod 僅 7 筆標記**（5 分類 / 1 日報 / 1 記錄，2 筆標錯）→ 替它建 LLM 重跑
> eval harness 是過度建設，M3 延後。M1（跨批準確率）+ M2（錯誤分群入口）＝低量也成立、
> 且讓標記有回饋（鼓勵累積），已落地：`getInsights` + `/label-insights` + 抽取準確率頁。
>
> 相關：[`conversation-analysis-pilot.md`](conversation-analysis-pilot.md) §6（label 機制既有）、
> [`extraction-schema-service-order.md`](extraction-schema-service-order.md)、`src/conversation-analysis/label.service.ts`
>
> 起於用戶提問：分析詳情頁點「標正確」有什麼效益？評估「回饋 AI」能帶來多少**真正的**效益。

---

## 1. 目標與範圍

**要回答的問題**：把人工「標對錯」的資料**回饋給 AI**，值不值得投入？若值得，第一步該做什麼？

**先破一個迷思**（本 doc 最重要的一句）：

> 對 Claude 這種 **API-based LLM，「標記 → AI 自動變聰明」的自動迴圈基本不存在**——你沒有在訓練模型。
> 真正把準確率往上推的，是**人在迴圈裡、用標記當原料去改 prompt / grounding**。
> 所以「回饋 AI」的效益大小，完全取決於選哪一種用法。

**範圍**：評估五種用法的真實 ROI（§3）、給誠實結論與建議路徑（§4）、切出最小有效的 M0 落地（§5）。
**不在範圍**：fine-tuning（§3 ④ 判定現階段負 ROI）、RLHF/DPO（抽取用不到）。

---

## 2. 既有現況走查（2026-07-31）

- `analysis_label` 表已存在（migration 0005）：`upload_id / target_type / target_id / correct(bool) / note / labeled_by / labeled_at`，upsert 語意（同人同標的更新）。
- `label.service.ts` 提供 `createLabel` / `listLabelsForUpload` / `getMetrics(uploadId)`。
- `getMetrics` 只算**單一 upload** 的污染率 / 日報正確率 / 記錄正確率，顯示在該分析詳情頁。
- **標記目前的終點就是這裡**：不跨批彙總、不回饋 AI、不改任何下游（grep 確認 pipeline / prompt 不讀 `analysis_label`）。
- 回歸驗證現況：只有 `samples/` 3 個檔（R12）——**沒有用真實客戶標記當評測集**。

---

## 3. ⭐ 站在巨人的肩膀上：五種用法 × 真實 ROI

| # | 用法 | 巨人怎麼做 | 對本系統的真實效益 | 判定 |
|---|---|---|---|---|
| ① | **評測集（eval-driven dev）** | OpenAI Evals / Anthropic evals / promptfoo / Braintrust / LangSmith · 「改 prompt 前先有帶答案的題庫」 | **最高 CP**。把真實標記變成**會長大的評測集**，取代/擴充 `samples/` 3 檔；改 prompt/模型時量得出漲跌、擋回歸。本身不提升準確率，**但它是其他一切的地基** | ⭐ **先做** |
| ② | **失敗案例挖掘 → 針對性改 prompt/主檔** | 「prompt iteration from failure cases」＝認真團隊的日常 · LangSmith/Humanloop 圍著它做 | **真正把準確率 80→90 的那一段靠這個**。把「標錯誤」分群 → 看出「老是把 A 當 B」「P-xxx 對不到」→ 改一句 prompt 或補一筆主檔 grounding。工廠語料錯誤多為**系統性**，最吃這招 | ⭐ 高效益（機制是**人工**讀分群後動手）|
| ③ | **動態/精選 few-shot** | DSPy（從標記 bootstrap 範例）· 語意檢索最相似已標範例塞進 prompt | 中等 · 只對**頑固特定錯誤**有感。**與現有 prompt caching 打架**（見 §6）：動態塞＝快取失效＝每次多花錢多延遲 | ⚠️ 有隱藏成本 · 針對性用 |
| ④ | **Fine-tuning** | OpenAI fine-tune 小模型逼近大模型、降成本 | **現在別做**：量不夠、per-tenant 模板還在變、Claude fine-tune 難拿；重訓/版本/評測 ops 成本 > 效益 | ❌ 現階段負 ROI |
| ⑤ | **Confidence 校準** | 用標記校準「high 信心」的真實正確率，調自動放行門檻 | 中等 · 給**確認迴圈**用（high 自動過、其餘人工）· 已有 high/med/low 欄位 | 之後可做 |

---

## 4. 誠實結論

1. **「讓 AI 自動變聰明」＝低效益 + ops 很重**——這條路的想像多半落空。
2. **真正的效益在 ①＋②**：標記 → 評測集 + 錯誤分群 → 人工改 prompt/主檔 → 回歸驗證。這是**人在迴圈的飛輪**，會真的推準確率，但不是魔法。
3. ⭐ **關鍵洞見**：「跨批彙總」其實是「回饋 AI」的**前置**——標記一定要先彙總成評測集 + 錯誤分群，才談得上改進。**所以先做①那層，同時服務「量測」與「改進」，不用二選一。**
4. **前提是量**：標記量太少，①②④全不成立（冷啟動摩擦，見 §6）。

> **一句話效益判定**：準確率的漲幅來自「標記所**啟動**的人工修正迴圈」，不是來自任何自動回饋機制。所以第一步不是「餵 AI」，是「把標記變成評測集 + 錯誤分群」。

---

## 5. 提案設計（M0 建議 scope）

**不要一開始就做自動 few-shot / fine-tune。** 先做最小有效地基：

### 5.1 評測集層（①）
- 跨 upload / 跨 tenant 彙總 `analysis_label`，凍出一組「輸入片段 → 人工答案」的**回歸題庫**。
- 提供 `npm run eval`：跑現行 prompt/schema 打題庫，輸出每類（分類/日報/記錄）正確率 + 與上次的 delta。
- 把它接進 R12 的回歸流程（現在只有 3 個 sample 檔）。

### 5.2 錯誤分群 view（②的入口）
- 把「標錯誤」的案例按 `target_type` + 錯誤形狀分群（先簡單：同分類被標錯、同欄位抽錯），
  列出「這種錯誤出現 N 次 / 集中在哪個 tenant / 模板」。
- 目的：讓人**一眼看出該改哪一句 prompt 或補哪一筆主檔**，而不是逐筆看。

### 5.3 明確**不做**（本期）
- ❌ 自動把範例塞進 prompt（few-shot）——先確認 §6 caching 取捨。
- ❌ fine-tuning。
- ❌ 自動改 prompt——改 prompt 一律人工（R12 回歸把關）。

---

## 6. 關鍵約束（動手前必讀）

| 約束 | 內容 |
|---|---|
| **Prompt caching 衝突** | 系統 prompt + 主檔掛 `cache_control`（穩定前綴）。動態 few-shot 會讓前綴變動 → 快取全失效 → 每次呼叫多花錢多延遲。若要 few-shot，只能用**靜態精選**塞進可快取的 system block，效果因此受限。 |
| **冷啟動 / 量門檻** | 沒有足夠標記量，評測集沒代表性、分群沒 signal。需先決定「誰標、標多少」（OQ-LFB-2）。 |
| **標記一致性** | upsert 是 per-labeler；多人標同一筆可能不一致。評測集的「標準答案」要定 tie-break 規則（OQ-LFB-3）。 |
| **評測集會過時** | 模板/schema 一改，舊題庫的「答案」可能失效。需標記題庫綁 schema 版本（OQ-LFB-4）。 |
| **標記本身是摩擦** | 「順手就標」才累積得起來。若標記要點很多下、又看不到回饋，沒人會標（產品設計問題，非技術）。 |

---

## 7. 里程碑

| # | 內容 | 依賴 |
|---|---|---|
| **M0** ✅ | 本 doc · OQ 全採建議 | — |
| **M1** ✅ | 跨批準確率彙總（`getInsights` · correct/total per type）· 抽取準確率頁 | — |
| **M2** ✅ | 錯誤分群入口（標「錯誤」案例對回原文 + AI 分類 + 租戶 + 連回詳情）| M1 |
| **M3** ⏸️ | ~~評測集 `npm run eval`（LLM 重跑 + 模糊比對 + delta）~~ · **延後**：prod 僅 7 筆，重跑 harness 過度建設；等標記量起來（OQ-LFB-2 內部標一批）再做 | 標記量 |
| **M4** ⏸️ | 靜態精選 few-shot（§6 caching 取捨談清後）· 針對頑固錯誤 | OQ-LFB-5 |

> **落地檔案**：`label.service.ts::getInsights`（withSystemTx + tenant filter）、`GET /conversation-analysis/label-insights`（convo:view · aiproot 看全/租戶看自家）、`web/src/convo-analysis/Insights.tsx`（抽取準確率頁）、`test/label-insights.test.ts`（4 測試：平台看全/租戶看自家/內容對回/無 result 不炸）。無 migration。

---

## 8. 開放問題（OQ-LFB-N）— 待裁定

| # | Impact | 問題 | 選項 | 建議 |
|---|---|---|---|---|
| ~~OQ-LFB-1~~ | ② | 投不投入這個迴圈？ | A. 先做 M1 地基 / B. 不做 | ✅ **A**（已做 M1+M2）|
| ~~OQ-LFB-2~~ | ① | 冷啟動誰標、標多少？ | A. aiproot 內部先標 ≥30/模板 / B. 等客戶 | ✅ **A** — ⚠️ **尚未執行**：prod 僅 7 筆，M3/評測集要等這批標完才有意義 |
| ~~OQ-LFB-3~~ | ② | 多人標不一致以誰為準？ | A. 最後標的贏（upsert）/ B. 裁決者 / C. 多數決 | ✅ **A** — 維持現況 upsert（最簡單；日後量大再升級 B）|
| ~~OQ-LFB-4~~ | ① | 題庫綁 schema 版本？ | A. 綁 / B. 不綁 | ✅ **A** — 但 M3（評測集）延後，實際綁定待 M3 落地 |
| ~~OQ-LFB-5~~ | ② | few-shot 碰不碰 caching？ | A. 本期不做 / B. 靜態精選 / C. 動態 | ✅ **A** — 本期不做，先靠 ①②（M4 延後）|

---

## 9. 失效場景反思（FMEA · R17）

| 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|
| 評測集偏誤（只標了容易/特定案例）→ 準確率數字虛高 | 誤判「AI 夠好了」而放大投入 | **P0** | 🔒 M1 抽樣要涵蓋各模板/tenant；分群 view 揭露標記分布，露出偏斜 |
| 題庫沒綁 schema 版本 → 改 schema 後假紅/假綠 | 回歸數字失真、改壞了沒發現 | P1 | ⚠️ OQ-LFB-4 選 A（綁版本）|
| few-shot 打壞 prompt caching → 成本/延遲暴增且無人察覺 | cost 悄悄漲 | P1 | 🔒 §6 明列；M3 前先過 caching 取捨；上線後看 cache 命中率 |
| 過擬合到少數標記範例 → 對沒見過的形狀更差 | 準確率不升反降 | P1 | ⚠️ 靜態精選 few-shot 上限筆數；用評測集守住整體不退 |
| 標記量長期不足 → 迴圈空轉 | 投入無回報 | P2 | ✅ OQ-LFB-2 定內部標一批當冷啟動；M4 一週觀察若無 signal 就收 |

---

## 10. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-01 | v0.2 | OQ 全採建議（1A/2A/3A/4A/5A）· **M1+M2 落地**：`getInsights`（跨批準確率 + 錯誤對回原文）+ `/label-insights`（aiproot 看全/租戶看自家）+ 抽取準確率頁 + 4 測試 · ⚠️ 現實檢查 prod 僅 7 筆標記 → **M3 LLM 重跑 eval 延後**（過度建設，等內部標一批）· OQ-LFB-2 內部標一批**尚未執行** | ahern + Claude Code |
| 2026-07-31 | v0.1 | M0 首版 · 起於「點標正確有什麼效益」· ⭐ 破迷思（API LLM 無自動學習迴圈）· 站在巨人肩膀上五法 ROI 表 · 誠實結論：效益在①評測集+②失敗挖掘（人在迴圈），few-shot 有 caching 成本、fine-tune 現階段負 ROI · 建議先做評測集+錯誤分群地基（同時服務量測與改進）· 5 OQ 待裁定 · FMEA 含評測集偏誤 P0 | ahern + Claude Code |
