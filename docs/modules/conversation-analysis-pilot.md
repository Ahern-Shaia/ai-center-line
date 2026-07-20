# conversation-analysis-pilot.md — [Priority-1] LINE 對話分析 · 用途 B pilot 設計文件

> 🚧 **狀態：DRAFT — 待用戶裁定 OQ-CVA-1..10（2026-07-20）**
>
> Scope: **用途 B pilot 版** — 手動接客戶匯出檔 → 我方跑分析 → 給結構化報告（PDF / Excel）供客戶付費。**不做 SaaS 化**（webhook / 寫 Ragic / confirm UI 全都不在本 scope），是「決定要不要 SaaS 化」之前的**驗證階段**。
>
> 目的:
> 1. 賺 pilot 收入 pay for R&D
> 2. 收集**真實對話**（非 mock）的抽取品質 metric — 尤其**污染率**（見 [[對話分析功能-可行性反思-2026-07-20]] §1）
> 3. 為未來 SaaS 化決策提供 evidence-based 判斷（現階段只有 mock 樣本、不知真實可行性）
>
> 依賴上游：
> - 現有 CLI prototype (`src/`) v0.1（parser / classify / schema / masterData / report 全鏈路已 work、mock 樣本抽取品質 acceptable）
> - notify v1.0（Ragic → LINE 通知，反方向、pilot 用不到、但為未來 SaaS 頻率設計預留 reuse）
>
> 相關：[[對話分析功能-可行性反思-2026-07-20]]（本 doc 的決策依據）
>
> 作者：Claude Code（草擬）
> 版本：v0.1（2026-07-20）

---

## 1. 目標與範圍

### 1.1 目標

1. **可交付**：接收客戶匯出的 LINE `.txt` → 產出結構化報告（PDF or Excel or 兩者）→ 客戶付費看得懂用得上
2. **可衡量**：跑完每個 pilot 客戶檔案後，人工 label 對照抽取結果、算出**污染率**（跨話題誤合併 / 錯歸屬）+ **event chain 完整度** + **實體對應準確度**
3. **可決策**：pilot 3 個月後、拿實測數據判斷「值不值得投 SaaS」— 若污染率 > X% 或客戶不覺得有用 → 不投
4. **可執行**：每 pilot 循環（收檔 → 跑 → 出報告 → 客戶 feedback）2-3 天內完成、我方單人可 handle
5. **無承諾**：不承諾 real-time、不接 webhook、不寫 Ragic、不做確認迴圈、不多客戶同時上線

### 1.2 對應 Stakeholder 訴求

| 訴求 | 誰 | 對應點 |
|---|---|---|
| 「業助真的每天需要對話自動抽日報嗎」 | sandy（台灣福祉業務窗口）或其他 pilot 客戶 | §5 pilot metric 收集會答 |
| 「污染率實際多糟」 | 我方戰略決策 | §6 accuracy metric 工具 |
| 「pay for R&D」 | 我方 cash flow | §3 M4 pilot 接單 + 收費 |

### 1.3 不做的事（scope 邊界、防 scope creep）

- ❌ **LINE webhook / 即時 ingest** — 用途 C 才做（見 §12 未來擴展）
- ❌ **Ragic 寫回 / 主檔 API 拉取** — 用途 C 才做
- ❌ **確認迴圈 UI / Flex confirm queue** — pilot 客戶直接看報告、有問題退還我方手動修
- ❌ **多客戶自動化 pipeline** — pilot 是**作坊模式**、1 客戶 1 次手動 kickoff、不做多租戶 config
- ❌ **prompt injection 全套防護** — pilot 讀 offline 匯出檔、風險相對低；用途 C 才做全套
- ❌ **Tier 3 手動 trigger 按鈕 / `/歸檔` 指令** — 見 OQ-CVA-5 明確砍（6 個 abuse 場景見 §10）
- ❌ **模型版本 / schema 版本化** — pilot 一切都是 snapshot、報告出去就 archive、不 replay
- ❌ **GDPR / retention 政策** — pilot 手動、資料在我方磁碟、客戶要刪就手動刪
- ❌ **SaaS 六大件全套** — 見 §12、非本 scope

---

## 2. 上游 / 既有現況走查

| 元件 | 現況（`src/` CLI）| Pilot 需求 | Gap |
|---|---|---|---|
| Parser (`parser.ts`) | ✅ 已 work · zh-TW / 12h / 續行 / 媒體標記 | 同 | 無 |
| Classifier (`classify.ts`) | ✅ Claude Opus 4.7 + cache + adaptive thinking | 同 | 無 |
| Schema (`schemas.ts`) | ✅ 三大類 zod（classifications / daily_reports / records） | 同 | 客戶客製欄位需擴展 |
| Master data | ✅ 硬編碼（`masterData.ts` 佑成 + `masterData.taiwanhomecare.ts` 台灣福祉）| 每 pilot 客戶要有自己主檔 | **需可插拔機制**（見 §5 M3） |
| Report renderer (`report.ts`) | ✅ HTML demo | 客戶要 PDF / Excel | **需 PDF/Excel 出口**（§5 M1）|
| Accuracy metric | ❌ 無 | 污染率量表 + human label 對比 | **全新做**（§5 M2）|
| Pilot 收單流程 | ❌ 無 | 收檔 → 跑 → 出報告 → 收費 SOP | **全新做**（§5 M4 + §11 SOP）|
| Segment 策略 | 按天切、超 60 則再切 | pilot 可能有大檔（跨月）| 需 upper limit + cost pre-flight |
| Prompt injection sanitize | ❌ 無 | pilot 讀 offline 檔、風險低 | out of scope（見 §1.3）|

---

## 3. 剩餘 scope 切分（M1–M5）

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M0** design review | 本檔 → APPROVED（用戶裁定 OQ-CVA-1..10）| 0.02 mo（0.5 日）|
| **M1** PDF / Excel 報告 renderer + 客戶客製欄位選擇 | 現有 HTML 加 PDF/Excel 出口；YAML 定義客戶想看哪些欄位 | 0.05 mo（1.5 日）|
| **M2** Accuracy metric 工具 | Human-label 對照 UI（web 簡單頁 or CLI）+ 污染率 / event chain / 實體對應三大 metric 定義與計算 | 0.05 mo（1.5 日）|
| **M3** 客製主檔快速套用機制 | YAML/JSON tenant config 檔（不改 code、新增客戶只加一個檔案）| 0.02 mo（0.5 日）|
| **M4** Pilot 客戶 1 接單 + 完整 cycle | 業務找 pilot 客戶（可能 sandy 或別家）→ 收匯出檔 → 跑 → 出報告 → 客戶 feedback → 我方 label 對照 → 出 accuracy metric | 0.10 mo（3 日 · 含跟客戶溝通時間）|
| **M5** FMEA + **戰略決策 checkpoint** | §13 FMEA 收尾；跑完 1-2 pilot 客戶後、**看實測 metric 決定要不要走 SaaS**（見 §12 checkpoint criteria）| 0.03 mo（1 日）|

**合計 M1–M5**：約 **7 人日**（不含 pilot 客戶等待 feedback 的時間）

---

## 4. M1 — PDF / Excel 報告 renderer

### 4.1 為什麼要 PDF/Excel（HTML 不夠嗎）

- HTML 適合 demo 展示、不適合客戶內部歸檔
- 客戶老闆 / 業務主管習慣 Excel（可 filter / 排序 / 做 pivot）
- PDF 適合正式報告（有簽名頁）

### 4.2 選項

| 選項 | 內容 |
|---|---|
| A | Excel + PDF 都做 |
| B | 只做 Excel（PDF 靠客戶自己列印 HTML）|
| C | 只做 PDF（客戶要 Excel 自己 export）|

（見 OQ-CVA-1）

### 4.3 客戶客製欄位

- 現有 schema 12 欄（reporter / machine_code / work_order / output_qty ...）
- 客戶可能只想看部分欄位、或想加自訂欄位（客戶名 / 車型 / 供應商）
- **實作**：YAML config 定義 `report_columns: [reporter_name, machine_code, work_hours, ...]`

---

## 5. M2 — Accuracy metric 工具（**本 pilot 最重要產出**）

### 5.1 為什麼要 metric

反思 doc §1.2 明確指出：**我方目前完全不知真實對話污染率是多少**。M2 是為了拿到這個數字。

### 5.2 三大 metric 定義

| Metric | 定義 | 計算方式 |
|---|---|---|
| **污染率**（cross-talk contamination rate）| AI 誤把 A thread 的訊息歸給 B thread（或反之）的比例 | 人工 label 每則訊息「應歸哪個 thread」→ 對照 AI classifications 結果 |
| **Event chain 完整度** | 一件事的多則訊息（e.g. 報修→查修→修復）AI 能正確合成 1 筆 record 的比例 | 人工列出真實 events、對照 AI records[i].source_ids |
| **實體對應準確度** | AI 把 LINE 顯示名對應到 `P-xx` code、機台名對應到 `ST-xx` code 的準確度 | 人工檢驗每筆 records 的 person/machine_code、算 correct% |

### 5.3 Label 工具

- **選項 A**：現有 HTML 報告 + 人工在 Google Sheet 標記（極簡、快）
- **選項 B**：寫個簡單 web UI（label 效率高、成本 2 天工程）
- **選項 C**：CLI 提示互動 label（單人可用、效率低）

（見 OQ-CVA-3）

### 5.4 Label 誰做

- **選項 A**：我方 domain 專家（我或用戶）自己 label — 準但工時高
- **選項 B**：pilot 客戶端 domain 專家 label — 貼近真實但客戶不想做
- **選項 C**：mixed（前 2 個 pilot 客戶客戶 label、之後我方 sampling label）

（見 OQ-CVA-3）

---

## 6. M3 — 客製主檔快速套用機制

### 6.1 現況痛點

新客戶進來要**動 code**（新增 `masterData.<客戶>.ts`）、violate 「無 code 改動加客戶」原則。

### 6.2 設計

- `tenants/<客戶 slug>.yaml`：
  ```yaml
  slug: taiwanhomecare
  company: 台灣福祉科技股份有限公司
  systemPromptOverrides:
    industryContext: 福祉車／復康巴士改裝廠
  masterData:
    persons:
      - { code: P-01, line_name: 組長-阿豪, full_name: 洪○○, role: 改裝組長 }
    stations: [...]
    work_orders: [...]
    glossary: {...}
  reportColumns: [reporter_name, machine_code, work_hours, work_order]
  ```
- CLI 加 `--tenant <slug>` 參數、讀對應 YAML 建 `Tenant` object 給 classifier
- **pilot 客戶 onboarding = 填一個 YAML**、無 code 改動

---

## 7. M4 — Pilot 客戶 1 接單 + 完整 cycle

### 7.1 Pilot 客戶候選

- **首選 sandy（台灣福祉）** — notify 已合作、關係熟、可能願意 pilot
- **次選** 其他透過關係介紹的工廠（3-6 人以下小廠、對數位化有需求）
- **避開** 大廠（決策慢、政治複雜）

### 7.2 Pilot cycle 流程

1. 業務跟客戶確認「願意提供 1 週 LINE 對話 + 讓我方看結果」
2. 客戶 LINE 群管理員匯出 `.txt` → 給我方（Email / cloud drive）
3. 我方確認 tenant YAML（1-2 小時填客戶主檔）
4. 跑 `npm run analyze -- --tenant <slug> <file>` → 產 report
5. 我方**先自己 label** metric（不讓客戶看）
6. 給客戶看報告 → 收 qualitative feedback（有用嗎 / 錯在哪 / 願意付多少 / 想要什麼欄位）
7. 我方紀錄 metric + client feedback 進 `pilot-log/<客戶>.md`

### 7.3 Pilot 收費模式

（見 OQ-CVA-4）

---

## 7-bis. 企業級 cross-cutting 檢核（本 module 適用性評估）

> 本 pilot 是**手動作坊**、非 prod SaaS、cross-cutting 檢核強度**降級適用**：

### 7-bis.1 安全模型（簡化）

| 攻擊面 | 緩解 |
|---|---|
| 客戶匯出檔含 PII（客戶名 / 電話 / 地址）| 我方磁碟加密 + 分析完 30 天內刪除原檔 + 不上傳到公開 repo |
| Anthropic API 洩漏客戶對話 | Anthropic 有 data policy、pilot 客戶簽合作前需告知「資料會過 Anthropic API」|
| Prompt injection | Pilot 讀 offline、風險相對低；出報告後我方肉眼 review（catch 幻覺）|

其他安全項目（DDoS / rate limit / secret / IAM）在 pilot 階段**不 applicable**（無公開 endpoint、無多用戶）。

### 7-bis.2 容量規劃

- Pilot 1 客戶 1 檔 = 1 次跑（<10 分鐘）
- 預估 3 個月 pilot cycle: 2-3 客戶 × 2-3 檔 = 10-15 次跑
- Anthropic API cost per pilot cycle: 估 $5-20（極低）

### 7-bis.3 失效模式

- Anthropic API 掛 → 手動 retry、單 cycle 影響
- 客戶檔案格式異常 → parser 有 fuzzy fallback + 我方肉眼 review
- 抽出來品質差 → **這正是我們要量測的事**（M2 metric）

### 7-bis.4 觀測性

- 手動 pipeline、無自動 log
- Metric 由 M2 工具產出、寫進 `pilot-log/`

### 7-bis.5 資料生命週期

- 客戶原始 LINE 匯出檔：**分析完 30 天內刪除**
- 抽取結果 JSON：保留（我方 archive、給客戶一份）
- Accuracy label：保留（作為 SaaS 決策依據）
- Client feedback 文字：保留

### 7-bis.6 向後兼容

- Pilot snapshot 一次性、無 replay 需求、無兼容包袱

### 7-bis.7 成本模型

Pilot 3 個月總成本：
- Anthropic API: ~$100（很寬鬆）
- 我方人時：~10 人日
- **總 R&D cost < $2000**、遠低於 SaaS 全套（$20000+）
- **Pilot 收入目標**：每客戶 NT$10,000-30,000（一次性報告）× 2-3 客戶 = 覆蓋 R&D cost

---

## 8. 測試策略

Pilot 是**驗證產品-市場適配**、不是驗證 code；測試策略也降級：

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | 現有 CLI 已有型別 + zod schema、無新 unit test | — |
| Regression | 樣本回歸（CLAUDE.md R12）— 動 schema/prompt/parser 時 `npm run analyze` 三樣本正確 | 現有 `samples/` |
| PDF/Excel renderer | 手動 review 樣本 output PDF/Excel 格式對 | 手動 |
| Metric 工具 | 用 mock label 資料驗計算 | 新增 `tests/metric.test.ts` |
| Pilot cycle | Pilot 客戶實跑就是最終驗證 | M4 |

---

## 9. 落地順序與里程碑

| M | 內容 | 估算 | 狀態 |
|---|---|---|---|
| **M0** | 本檔 → APPROVED | 0.02 mo | ⏳ |
| **M1** | PDF/Excel renderer + YAML report_columns | 0.05 mo | ⏳ |
| **M2** | Accuracy metric 工具 + 3 metric 定義 | 0.05 mo | ⏳ |
| **M3** | Tenant YAML config 機制 | 0.02 mo | ⏳ |
| **M4** | Pilot 客戶 1 接單 + 完整 cycle + client feedback + metric 落地 | 0.10 mo | ⏳ |
| **M5** | FMEA + **戰略決策 checkpoint** | 0.03 mo | ⏳ |

---

## 10. 開放問題（OQ-CVA-N）

### 10.1 Pilot 本期 OQ（1-4、需用戶裁定）

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-CVA-1** | 報告格式 | A. Excel+PDF 都做 / B. 只 Excel / C. 只 PDF | **A** — 兩者成本差不多、覆蓋不同客戶偏好 |
| **OQ-CVA-2** | 客製主檔套用 | A. YAML config 檔 / B. Google Sheet / C. 客戶自行編 code | **A** — YAML 直觀、我方可 version control |
| **OQ-CVA-3** | Metric label 工具 & 誰 label | A. HTML+Google Sheet 我方 label / B. web UI + 客戶 label / C. mixed | **A** — 快、單人可 handle、pilot 少不需 UI |
| **OQ-CVA-4** | Pilot 收費模式 | A. 一次性 NT$10-30k / B. 訂閱 NT$5k/月 / C. 免費賺 case study | **A** — pilot 一次性合理、訂閱要 SaaS 才 make sense |

### 10.2 未來 SaaS OQ（5-10、pre-decision 給用戶 confirm；SaaS 落地時再 formally 走）

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-CVA-5** | Tier 3 手動 trigger 是否納入未來 SaaS | A. 納入 / B. **砍** | ✅ **B 已裁定**（2026-07-20 用戶戳）— 6 個 abuse 場景（thundering herd / 無 auth / bot 誤觸 / 無 rate limit / 跟 auto batch 撞單 / scope creep）；mitigation 成本 > feature value |
| **OQ-CVA-6** | SaaS 頻率設計 | A. 即時 / B. N 分鐘 / C. 每小時 / D. 每天 / E. 事件驅動 / F. 手動 / H. layered | ✅ **H = Tier 1 (D daily 20:00) + Tier 2 (E event-driven) + Tier 4 (confirm reuse notify)**（2026-07-20 用戶 confirm）|
| **OQ-CVA-7** | Tier 2 abuse 防護 | 需明確 rate limit / dedup / signature | rate=5min 內同 sheet 3 次上限 / dedup by (sheet_id, record_id, 15min window) / signature = Ragic Workflow secret（reuse notify pattern）|
| **OQ-CVA-8** | Tier 4 race condition | 同 candidate 多人 confirm 誰贏 | **first-confirm-wins** + Ragic status 加 `confirmed_by` + `confirmed_at` lock |
| **OQ-CVA-9** | Pilot → SaaS checkpoint | 什麼條件下決定投 SaaS | 提議：**污染率 < 20% + 至少 1 客戶願付 NT$5k/月 + client feedback qualitative 正面**（三條全滿足才投）|
| **OQ-CVA-10** | Pilot 時效 | 多久做決策 | 提議：**3 個月**（M4 起算）—超過 3 個月無決策 → 資源投別的 |

---

## 11. SOP — Pilot 作業流程

### 11.1 新 pilot 客戶 onboarding（每客戶 1 次）

1. 業務簽 pilot 合作（範本合約 + 資料處理告知）
2. 建 tenant YAML `tenants/<客戶 slug>.yaml`（1-2 小時）
3. 建 `pilot-log/<客戶>.md`（紀錄 baseline info）
4. 通知客戶「請匯出 LINE 對話給我方」

### 11.2 每個 pilot cycle（收檔 → 出報告）

1. 客戶送 `.txt` → 存 `pilots-inbox/<客戶>-<日期>.txt`
2. Verify 格式 `npx tsx scripts/verify-line-export.ts <file>`（新增 script、格式 sanity check）
3. 跑 `npm run analyze -- --tenant <slug> pilots-inbox/<檔案>`
4. Output 落 `pilots-output/<客戶>-<日期>/`（HTML / PDF / Excel / JSON）
5. 肉眼 review 30 分鐘（catch 明顯幻覺 / 抽錯）
6. 我方 label metric（M2 工具、算污染率等）→ 寫入 `pilot-log/<客戶>.md`
7. 給客戶報告 + 訪談收 feedback
8. 30 天後 `rm pilots-inbox/<客戶>-<日期>.txt`（PII cleanup）

### 11.3 失敗排查

| 症狀 | 處置 |
|---|---|
| Parser 抽不到訊息 / regex 對不到 | 檢查 LINE 匯出版本、fuzzy fallback、必要時 patch parser |
| Anthropic API 500 / timeout | 手動 retry（無 auto retry 設計）|
| 抽出來幻覺明顯 | 手動修 tenant YAML glossary / persona、重跑 |
| Cost 爆（>$10/cycle）| Segment 策略調整 / 檔案切小段 |

---

## 12. 未來擴展 · 若走 SaaS（用途 C）

> **非本 doc scope**、但 pre-decision 記錄下來、將來 SaaS 落地時用

### 12.1 Layered 頻率設計（OQ-CVA-6 已裁定）

| Tier | 觸發 | 說明 | 對應優點 |
|---|---|---|---|
| **Tier 1** | Daily batch 20:00 cron | 跑當天全群對話、隔天 08:00 業助上工前完成 | 完整 context / 業務 rhythm alignment / cost 可預估 |
| **Tier 2** | Event-driven（Ragic 動作觸發 → 拉近 6h LINE + 抽相關對話）| 業助新增/更新 Ragic 單 → 自動 backfill 對應對話 detail | Scope 窄污染低 / 貼工作流 / 跟 notify 反向 pair |
| **~~Tier 3~~** | ~~Manual button / `/歸檔`~~ | ✅ **砍**（OQ-CVA-5）| 6 個 abuse 場景 |
| **Tier 4** | Confirm 通知 reuse notify | Candidate → Flex confirm 到業助群 | Reuse SHIPPED 基建 |

### 12.2 Tier 2 abuse 防護（OQ-CVA-7）

- **Rate limit**：per-sheet 5 分鐘內最多 3 次觸發、超過 skip
- **Dedup**：(sheet_id, record_id, 15min window) key
- **Signature**：只認 Ragic Workflow 帶的 `X-Notify-Secret`（reuse notify pattern）
- **Trigger 白名單**：只認來自客戶端 Ragic 特定 workflow 的 request

### 12.3 Tier 4 race condition（OQ-CVA-8）

- First-confirm-wins：同 candidate 第一個 confirm 定案
- Ragic status 欄位加 `confirmed_by` + `confirmed_at`
- 後續 confirm 按鈕點下去顯示 toast「已由 X confirm 於 Y 時間」
- 拒絕（reject）同規則

### 12.4 六大件補齊路線圖（若 M5 checkpoint 通過）

1. **LINE webhook ingest**（取代手動匯出）
2. **主檔 Ragic API 拉取**（取代 YAML 硬編碼）
3. **Dedup by (group_id, msg_id, run_batch_id)**
4. **Confirm queue UI + Flex message**（reuse notify）
5. **Ragic 寫回機制**
6. **Prompt injection 全套 sanitize**

估：3-6 個月工程 + 需求先確認過 pilot metric 支持

---

## 13. 失效場景反思（FMEA）— M5 收尾必填（R17）

### 13.1 Pilot cycle 本身

| # | 場景 | 影響 | 緩解 | Sev |
|---|---|---|---|---|
| P1 | 客戶匯出 LINE 版本變（app update）→ parser regex 對不到 | 訊息大量漏 | Verify script 先跑 sanity check、失敗 raise 而非 fallback silently | P1 |
| P2 | 客戶檔案含 500+ 訊息大批 → cost 爆 + 對話污染惡化 | 一次跑 >$10 + 抽取品質下降 | Pre-flight cost 估算、超上限給 client 說「請切段」| P1 |
| P3 | 抽出來幻覺（e.g. 客戶說「這批全報廢」→ AI 抽 defect_qty=全部）| 錯誤資料進報告、客戶不信任 | M4 SOP 加人工 review 30 分鐘 gate；未 catch 到就出 → 收 feedback fix | P0 → P1（by SOP）|
| P4 | 客戶原檔案含極敏感 PII（醫療紀錄、身份證）| 資料外洩風險 | 合作前告知客戶「請先脫敏」；我方磁碟加密 + 30 天刪除 | P1 |
| P5 | Anthropic API 掛 → cycle 停 | pilot 進度延遲 | 手動 retry / 換排程 / 通知 client | P2 |

### 13.2 Pilot 決策風險（M5 checkpoint 相關）

| # | 場景 | 影響 | 緩解 |
|---|---|---|---|
| D1 | Pilot 客戶 label 品質差、metric 不可信 | SaaS 決策基於錯 metric | 我方主 label（OQ-CVA-3 A）確保一致性 |
| D2 | Pilot 3 個月找不到願付客戶 → M5 checkpoint fail | 產品定位錯、需 pivot | 3 個月 fixed timebox、無 sunk cost 陷阱、直接砍 |
| D3 | Pilot 客戶 feedback 極好但 metric 極差 → 決策矛盾 | 定性 vs 定量衝突 | Metric 為主、feedback 為輔（避免確認偏誤）|
| D4 | 客戶 feedback 說「不錯但我不想付錢」 | Product-market fit 假象 | Willingness-to-pay 是硬指標、免費不算 |

### 13.3 未來 SaaS 若走的 abuse（OQ-CVA-5/7/8 已 pre-decision、SaaS M0 時 formally 走完整 FMEA）

- Tier 3 abuse 見 §12（已砍、no residual risk）
- Tier 2 thundering herd / duplicate / bot 誤觸 → §12.2 已列 3 個 mitigation
- Tier 4 race → §12.3 已列 first-confirm-wins

### 13.4 對話污染（**本 module 的核心風險、也是 pilot 的主要驗證目標**）

見反思 doc §1、pilot M2 metric 就是量這個。若 pilot 顯示污染率 > OQ-CVA-9 threshold → SaaS 不投。

---

## 14. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-20 | v0.1 | 初版 DRAFT — Scope 用途 B pilot；M0-M5、OQ-CVA-1..10、FMEA skeleton；§12 未來 SaaS 擴展 pre-decision（Tier 3 砍、Tier 1+2+4 頻率、Tier 2 abuse、Tier 4 race）| Claude Code |
