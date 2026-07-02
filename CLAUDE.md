@AGENTS.md

# CLAUDE.md — ai-center-line 開發指引

> 本文件是 Claude Code 在 ai-center-line 中的最高指導原則。所有開發任務開始前，Claude Code 必須先讀完本文件。

> 狀態：POC 已驗證，準備進 Phase 1 開發
>
> 分類抽取 prototype（LINE 匯出檔 → AI 分類抽取 → JSON/HTML）已完成並以模擬資料驗證。近期重點：配合產發署數位轉型補助計畫送件（2026-07 上旬）、接真實客戶匯出檔驗證、Phase 1（LINE webhook 服務 + Ragic 匯流 + 確認迴圈）開發。

---

## 0. 專案身份

- **名稱**：ai-center-line（LINE 群組 AI 對話分析系統）
- **用途**：工廠 LINE 群組對話 → AI 語意分類與結構化抽取 → 匯流 Ragic ERP／知識庫 → AI 戰情室後台；核心原則是不改變工廠員工的 LINE 使用習慣
- **語言**：TypeScript（Node.js，ESM）
- **運行**：目前為本機 CLI prototype；Phase 1 起為 webhook 服務，目標多租戶 SaaS
- **授權**：proprietary
- **Git remote**：TBD（local repo，main 分支，尚無 remote）

---

## 1. 不可違反的鐵則

### 1.1 一般開發

| 規則 | 說明 |
|---|---|
| **R1** | 任何破壞性修改（DB schema、API 介面、抽取 schema）**必須先寫遷移計畫**，說明影響範圍 |
| **R2** | 安全敏感模組（認證、權限、審計、計費）**必須有單元測試 + 整合測試**，覆蓋率 > 80% |
| **R3** | **不可在程式碼中硬編 secret**（API key、密碼、token）。一律走環境變數或 secret manager；本專案用 `.env`（已在 .gitignore） |
| **R4** | 涉及 SQL 執行的功能**必須走 prepared statement**，禁止字串拼接 |
| **R5** | 所有寫入操作**必須記錄 audit log**，包含 actor、action、target、timestamp、result |

### 1.2 Claude Code 行為

| 規則 | 說明 |
|---|---|
| **R6** | Claude Code **不得自行決定架構**。重要設計（資料模型、API 介面、狀態機）**必須先寫設計文件、由人 review 後再實作**（用 `docs/modules/<module>.md` 模板）|
| **R7** | Claude Code 在不確定時**必須停下來問**，不可猜測。例外：使用者明確說「全部由你決定」時，可在已宣告的範圍內裁定 |
| **R8** | **每個 task 完成後必須跑完整測試 + lint + build**，全綠才算完成（本專案現況見 §3） |
| **R9** | **不得使用 `--no-verify` 跳過 git hook**；不得用 `git push -f` 推 main 分支 |
| **R10** | 涉及生產環境的任何操作（部署、執行 SQL、資料變更）**必須由人手動執行**，Claude Code 只能產生指令，不能直接執行 |
| **R17** | **功能標「完成」或上 prod 前，必須產出 FMEA 失效場景反思** — 逐路徑（每個入口 / 外呼 / 狀態轉換 / 並發點 / 部署順序）列「失效模式 → 影響 → 嚴重度（P0/P1/P2）→ 緩解狀態（✅/⚠️ 殘留/🔒 外部 gate）」，寫進 design doc 固定章節（範本見 `docs/modules/_template.md`「失效場景反思（FMEA）」段）。**任一 P0 未緩解不得上 prod**；已知殘留也要列（為何可忍 + 治本方向）。無 design doc 的小改動 / hotfix 至少在回報中口頭列失效場景 + 緩解。心態 = pre-mortem（假設它已壞，反推為什麼），不是只測 happy path |

> R17 編在 §1.2（通用行為鐵則）而非 §1.3 —— 它不依專案技術棧，不可砍。

### 1.3 程式碼層硬規則（本專案版）

| 規則 | 說明 |
|---|---|
| **R11** | **來源可溯源**：所有 AI 抽取結果必附 `source_ids` 回溯到原始訊息；原始訊息落庫後不可變。缺漏欄位填 `null`，禁止讓模型臆測數字 |
| **R12** | **抽取 schema / prompt 變更必回歸驗證**：改 `src/schemas.ts` 或 system prompt 後，必重跑 `samples/` 三個樣本檔，分類覆蓋率與日報抽取正確性不可下降 |
| **R13** | **LINE 媒體即收即存**：webhook 服務實作後，照片/影片/檔案必須在收到事件時立即下載保存（LINE content URL 有時效） |
| **R14** | **新代碼一律 TypeScript ESM**（`type: "module"`）；套件管理固定 **npm**，不可混用 pnpm / yarn |
| **R15** | **Pre-PR Checklist**：對外發布 / 上線前必須走過 `docs/pre-pr-checklist.md`（solo dev 不走 PR ceremony，但上線前檢查不可省） |
| **R16** | **前端設計鐵則**（戰情室後台開發時生效）：所有前端產出必過 `docs/frontend-design-principles.md` —— §A 普世核心一律適用（**含 §A5 先研究≥3競品再設計，不可略**）、§C 設計流程迴圈動手前先跑；**§B 美學 profile：客戶／委員面（台灣福祉）鎖定 `civic-trust`**（2026-07-03 用戶裁定，定義見該檔 §B0-CT；暖紙白×深松綠×赤土、serif 數字、每數字掛來源）。`mission-control-dark` 已由 civic-trust 取代。要換必須由人改本鐵則 + §B 並說明理由 |

### 1.4 執行模式（autonomy level）

> 用戶在啟動 Claude Code 時可選兩種執行模式之一：

**Mode A — 互動模式（預設）**：
- 每個高風險動作前確認（重啟 / 動 prod / 大範圍刪除）
- 適合：新專案探索期、不熟領域、需共同決策
- 對應 feedback：`feedback_single_task_execution.md`

**Mode B — 企業級自主模式**：
- 啟動指令：`claude --dangerously-skip-permissions`
- 含意：用戶**主動移除摩擦** + **要求加深度**（不是降低標準）
- 行為調整：
  - 平行 Agent / 背景 Monitor / 試錯 repro 不再每次問
  - 每個 commit 主動跑 cross-cutting checks（security / observability / cost / compat 四檢，見 `memory/rule_cross_cutting_checks.md`）
  - design doc 範本擴 §安全模型 / §容量 / §失效 / §觀測 / §成本 / §兼容 六大章節
  - Trade-off 主動 surface（不等用戶問就告知影響）
- **仍會停下來的情境**：架構選擇 / 砍-留決策 / business logic 模糊 / `git push -f` 等不可逆操作
- 對應 feedback：`feedback_enterprise_execution.md`

> 用戶於對話開頭明說「企業級」/「商用系統」/「production-grade」即切到 Mode B。

---

## 2. 技術棧

### 2.1 核心（現況：CLI prototype）
- TypeScript / Node.js 24（ESM）
- `@anthropic-ai/sdk`：Claude Opus 4.7（`claude-opus-4-7`）、結構化輸出（zod schema）、prompt caching、adaptive thinking
- `zod`：抽取結果 schema 定義與驗證
- 資料：檔案型（`samples/*.txt` → `output/*.json|html`）；主檔目前為 `src/masterData.ts` 模擬資料

### 2.2 Phase 1 起新增（規劃中，實作前先寫 design doc — R6）
- LINE Messaging API：webhook 事件接收、Flex Message 確認迴圈、reply token 優先（push 訊息計費）
- Ragic HTTP API：主檔拉取（人員/機台/工單）＋ 確認後記錄寫入
- 持久層：TBD（design doc 裁定）

### 2.3 工具
- 套件管理：**npm**（不可混用 pnpm / yarn）
- 執行：`tsx`；型別檢查：`tsc --noEmit`
- lint / format：**尚未配置**（配置後補進 R8 全綠清單與本節）

---

## 3. 開發流程

詳細指令見 `AGENTS.md`。摘要：

```bash
npm run analyze                 # 跑完整 pipeline（samples/ → output/），需 .env 的 ANTHROPIC_API_KEY
npm run analyze -- <檔案.txt>   # 分析指定 LINE 匯出檔
npx tsc --noEmit                # 型別檢查
```

每個 task 完成後（R8，依現況調整）：

1. **型別檢查**：`npx tsc --noEmit` 必須 0 error
2. **回歸驗證**（動到 schema / prompt / parser 時）：重跑 `npm run analyze`，比對 `output/` 分類覆蓋率與日報抽取結果（R12）
3. lint / format / 單元測試配置後，補進此清單並全綠

---

## 4. 程式碼目錄結構

```
ai-center-line/
├── src/
│   ├── index.ts            ← CLI 入口（讀檔 → 分析 → 輸出 JSON/HTML）
│   ├── parser.ts           ← LINE 匯出檔解析 + 以天切分會話段
│   ├── classify.ts         ← Claude API 分類抽取（system prompt、caching）
│   ├── schemas.ts          ← zod 抽取 schema（分類/日報/記錄）
│   ├── masterData.ts       ← 模擬 Ragic 主檔 + 工廠詞庫（Phase 1 改接 Ragic API）
│   ├── report.ts           ← HTML 視覺化報告
│   └── types.ts            ← 共用型別
├── samples/                ← 模擬 LINE 匯出檔（回歸驗證基準，勿隨意改動）
├── output/                 ← 分析輸出（gitignore）
├── docs/
│   ├── 計畫書-系統架構文件.md|docx  ← 產發署補助計畫技術章節素材
│   ├── pre-pr-checklist.md
│   ├── cleanup-plan.md
│   ├── frontend-design-principles.md
│   └── modules/<module>.md ← 模組詳細設計（CLAUDE.md R6）
├── CLAUDE.md  AGENTS.md
└── .env                    ← ANTHROPIC_API_KEY（gitignore）
```

---

## 5. 與 Claude Code 協作

### 5.1 任務啟動流程
1. 讀完 `CLAUDE.md`（本檔）+ `AGENTS.md`
2. 讀對應模組 `docs/modules/<module>.md`（如有）
3. `git status` 確認在乾淨分支（git init 後適用）
4. 確認 `.env` 存在、`npx tsc --noEmit` 乾淨

### 5.2 任務拆解粒度

**原則**：一個 task 應**一個檔案內 + 改動 < 200 行 + 單一 commit**。複雜功能拆多 task 串接。

模組級任務按 **M0 → M1 → M2 → M3 → M4** 切：
- **M0**：寫 design doc，列開放問題（OQ-XYZ-N），等用戶裁定
- **M1–M3**：實作各 sub-task，每個 milestone 一個 commit
- **M4**：docs 收尾 + MODULES.md 標 ✅

### 5.3 何時必須停下來問

| 情境 | 為什麼 |
|---|---|
| 需要修改現有共用模組 | 影響範圍大，可能破壞其他模組 |
| 需要新增 DB schema 或 migration | 影響面廣，需設計 review |
| 需要繞過或停用既有測試 / 樣本回歸 | 通常表示發現真實問題 |
| 業務邏輯模糊（工廠領域、Ragic 欄位對應） | 領域知識需用戶 / 客戶端主導 |
| 需要新增第三方依賴 | 影響供應鏈安全 |
| 大規模重新命名 / 刪除 | 不可逆操作，需明確授權 |
| 動到 `samples/` 基準資料 | 是回歸驗證的基準，改了會讓歷史比對失效 |

### 5.4 Commit 規範

Commit 訊息：`<type>(<scope>): <description>`（例 `feat(classify): add attendance extraction`、`fix(parser): handle 12h time edge case`）。

Solo dev 不走 PR ceremony（見 memory `feedback_no_pr_workflow.md`）；上線前走 `docs/pre-pr-checklist.md`（R15）。

---

## 6. Quick Reference

| 用途 | 路徑 |
|---|---|
| 本主指引 | `CLAUDE.md` |
| Dev workflow 細節 | `AGENTS.md` |
| 模組詳細設計 | `docs/modules/<module>.md` |
| Pre-PR Checklist | `docs/pre-pr-checklist.md` |
| Cleanup 收斂規劃 | `docs/cleanup-plan.md` |
| 前端設計原則（核心 + 美學 profile） | `docs/frontend-design-principles.md` |
| 計畫書技術章節素材 | `docs/計畫書-系統架構文件.md` |

---

## 附錄：本文件變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-02 | v1.0 | 套用 claude-starter 並依本專案客製（§0 / §1.3 / §2 / §3 / §4） | ahern + Claude |
