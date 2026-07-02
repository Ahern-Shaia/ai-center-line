This file provides guidance to AI coding assistants when working with code in this repository.

## Project Architecture

LINE 工廠群組對話分析 pipeline（TypeScript / Node.js ESM CLI prototype）：

- 入口為 `src/index.ts`：讀 LINE 匯出檔（`samples/*.txt` 或指定路徑）→ 解析 → AI 分析 → 輸出 `output/*.json` + `output/*.html`
- `src/parser.ts` 解析 LINE zh-TW 匯出格式（12 小時制「上午/下午」、多行訊息續行、`[照片]`/`[貼圖]` 媒體標記、系統訊息），並以「天」為單位切分會話段
- `src/classify.ts` 呼叫 Claude API（`claude-opus-4-7`）做分類與結構化抽取；system prompt + 主檔放 system blocks 並掛 `cache_control`（prompt caching）
- `src/schemas.ts` 是抽取結果的 zod schema（classifications / daily_reports / records）——**這是資料契約**，改動視同破壞性修改（CLAUDE.md R1、R12）
- `src/masterData.ts` 為模擬 Ragic 主檔（人員/機台/工單/詞庫），抽取時作 grounding；Phase 1 將改為 Ragic API 拉取
- API key 從環境變數或專案根目錄 `.env` 讀取（`ANTHROPIC_API_KEY`）

## Development Workflow

**ALWAYS follow these steps after making code changes:**

1. **Type check** — `npx tsc --noEmit`，必須 0 error
2. **回歸驗證**（動到 `parser.ts` / `classify.ts` / `schemas.ts` / system prompt 時）— `npm run analyze` 重跑三個樣本檔，確認：
   - 訊息分類覆蓋率 100%（console 無「未被分類」警告）
   - 報工群日報抽取 8 筆、實體對應（P-xxx / M-xxx / WO-xxx）正確
   - cache 讀取正常（第 2 次呼叫起 `cache讀 > 0`）
3. **Lint / format** — 尚未配置；配置後補進此清單
4. **Parser 單獨驗證**（只動 parser 時可用快路徑，不花 API 費用）— 寫臨時 tsx 腳本呼叫 `parseLineExport` + `segmentMessages` 檢查訊息數/切分

## Build/Test Commands

```bash
# 跑完整 pipeline（預設吃 samples/*.txt）
npm run analyze

# 分析指定 LINE 匯出檔
npm run analyze -- path/to/匯出檔.txt

# 型別檢查
npx tsc --noEmit

# 產出計畫書 Word 檔（docs/*.md → .docx）
pandoc "docs/計畫書-系統架構文件.md" -o "docs/計畫書-系統架構文件.docx" --from gfm --to docx
```

## Code Style

### General

- Write clean, minimal code; fewer lines is better
- Prioritize simplicity for effective and maintainable software
- Only include comments that are essential to understanding functionality or convey non-obvious information
- TypeScript strict mode；ESM（`type: "module"`），相對 import 需帶 `.js` 副檔名

### Naming

- 程式碼識別字用 American English；使用者可見字串（console、HTML 報告、prompt）用繁體中文
- Avoid plurals like "xxxList"

### AI / prompt 相關

- System prompt 屬穩定前綴（prompt caching）：**易變內容（日期、per-request 資料）禁止放 system blocks**，一律放 user message，否則快取全失效
- 模型固定 `claude-opus-4-7`＋結構化輸出（`output_config.format` + zod）；改模型或 schema 需先討論（等同資料契約變更）
- 抽取欄位缺漏一律 `null`，禁止讓模型臆測；推斷值必須降 confidence

### Frontend / UI design（戰情室後台開發時生效）

- 任何前端產出動手前先過 [`docs/frontend-design-principles.md`](docs/frontend-design-principles.md)：§A 普世核心一律適用（含 §A5 先研究≥3競品）、§C 設計流程迴圈動手前先跑；§B 美學 profile 本專案鎖 `civic-trust`（客戶／委員面，§B0-CT）；**只用淺色，不用深色**
- 元件走語意 design token、禁硬編 hex；spacing 用 `gap-*`
- 現有 `src/report.ts` 的 HTML 報告是 demo 用產物，不受 §B profile 約束

### Error Handling

- Be explicit but concise about error cases
- API 呼叫失敗讓 SDK 自動重試（內建 429/5xx backoff），不要自己包重試迴圈

## Pull Request Guidelines

Solo dev 直接 commit（見 memory `feedback_no_pr_workflow.md`），commit 格式 `<type>(<scope>): <description>`。對外發布 / 上線前走 [`docs/pre-pr-checklist.md`](docs/pre-pr-checklist.md)。

## Miscellaneous（本專案踩坑）

- **專案路徑含中文（`創業`）**：Claude Code 的 memory 目錄編碼為 `-Users-ahern-Documents----ai-center-line`（非 ASCII 字元逐字轉 `-`）；任何用 `sed 's|/|-|g'` 推導路徑的腳本（如 claude-starter 的 setup.sh）在本專案都會算錯，須手動指定
- **`tsx -e` 無法解析相對 import**（eval 情境下 `./src/...` 會 MODULE_NOT_FOUND）：測試片段寫成臨時檔用絕對路徑 import，或直接跑 `npx tsx <file>`
- **Opus 4.7 最小可快取前綴為 4096 tokens**：system prompt＋主檔若低於門檻會靜默不建快取（`cache_creation_input_tokens: 0`），不是 bug
- **LINE 匯出格式**：時間為「上午/下午 h:mm」12 小時制（上午12=00 時、下午12=12 時）；多行訊息的續行沒有時間前綴，須併回前一則；`儲存日期` 標頭行要跳過
- **LINE content URL 有時效**（webhook 服務階段）：媒體必須即收即存，不能只存 URL
- **`samples/` 是回歸基準**：改樣本檔會讓歷史驗證結果失去比對意義，動它前先問（CLAUDE.md §5.3）

## 戰情室資料綁定（src/warroom/）

v7 戰情室三個角色視圖由 renderer 統一產生，非手寫 HTML mock：

```bash
npm run warroom   # data/*.json → aggregate → 渲染 output/warroom-{tenant_admin,aiproot_admin,group_owner-D2}.html
```

- 資料源：`data/taiwanhomecare-warroom.json`（tickets，對應 spec §4.5 schema）＋ `data/aiproot-overview.json`（跨租戶聚合，刻意不含 tickets 內容＝租戶隔離）。
- `aggregate.ts` 按委員鐵律公式計算三環形儀表（簽核率=已簽核÷6、健康度=綠燈÷6、高信心=high÷已標）；改資料後 `npm run warroom` 應算出 33%/67%/62%。
- `render.ts` 共用一份 civic-trust styles，三視角吃同一份 aggregate；改視覺改這裡，不改 output/（output/ 為 build 產物、gitignore）。
- 委員簡報用截圖在 `docs/mockup/戰情室-*-v7.png`（改版後重截）。
