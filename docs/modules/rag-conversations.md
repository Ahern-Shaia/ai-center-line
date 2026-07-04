# rag-conversations.md — [P1] 智慧檢索 RAG 對話 設計文件

> 🚧 **狀態：DRAFT — 待用戶裁定 OQ-RAG-1..8（2026-07-04）**
>
> 把戰情室 §1-C C3「智慧檢索 RAG 對話」的規格落成可執行實作：多輪 session、跨資料源（LINE 群組訊息 / tickets / knowledge_cards / 多模態檔案 / 工研院 RAG）grounded 檢索、inline citation + 兩窗格 source viewer（NotebookLM 風）、AI followup。前端 mock 已跑通兩窗格佈局 + 多模態 source 檢視（`web/src/Rag.tsx` + `web/src/mockdata/ragQA.ts` 含 image / spreadsheet 兩類多模態 fixture），本模組把後端接起來讓對話真的走 pipeline。
>
> 作者：Claude Code（草擬）
> 版本：v0.2（2026-07-04）

---

## 1. 目標與範圍

### 1.1 目標

1. **多輪對話 session**：使用者可在同一對話內連續問，前後文帶入下一輪；session 可命名、可回頭
2. **Grounded citation 含多模態**：每一段 AI 回答必掛 `citations[]`，citation 覆蓋 6 種 kind：`knowledge_card` / `ticket` / `raw_message` / `itri` / `image` / `spreadsheet`。點 `[1]` 直接在右窗格 render 該檔（文字類走 snippet，圖檔類走 image viewer，試算表類走 HTML table 預覽）
3. **兩窗格佈局（NotebookLM 風）**：左側 chat + 建議 chips + 輸入框；右側常駐 source viewer（不是 modal）— 空狀態秀「先問一個問題」；有引用時秀本次對話累計引用清單；選中某 citation 時秀單筆 render；詳見 §4.5
4. **AI followup**：AI 回答完主動生成 1 個相關追問，使用者可直接點採納
5. **檢索範圍受 RLS 約束**：group_owner 只查得到本部門；tenant_admin 查得到全 6 部門；aiproot_admin / consultant 依 §4 規則。RLS 是硬底線，不靠應用層濾
6. **審計每一次 query**：R11 溯源 + §12 稽核鐵則的實現；每個 query 寫 `audit_log(action='km_query')` 含 session_id / 提問 / 命中卡片 ID / 使用者
7. **成本可控**：每組合成上限、每租戶 daily quota、每 session 最長輪次

### 1.2 對應主管 / Stakeholder 訴求

| 子題 | 主要訴求 | 次要訴求 | 對應點 |
|---|---|---|---|
| A1 對話 session 資料模型 | § 系統設計文件 B3-3 | R11 | 建 `conversations` / `conversation_messages` + `citations jsonb` 一次到位；後續 followup / 反查全靠這張表 |
| A2 檢索管線（BGE-M3 → Claude synthesize） | §7.4、§1-A [10] RAG 索引 | R11 溯源 | KM 抽取已規劃走 BGE-M3；本模組把「query 端」串起來，同時 retrieve 跨 tickets / knowledge_cards / message excerpts |
| A3 `POST /rag/conversations`＋`POST /rag/conversations/:id/messages` | §1-B B3-3、§10.1 | R2 (auth) | Nest controller + guard + zod schema；取代原型的 `POST /km/query` |
| A4 前端接後端 | 現況 `Rag.tsx` 兩窗格 mock 已跑通 | 中文優先 UI | 保留兩窗格佈局，把 `mockdata/ragQA.ts` 換成 API 呼叫 |
| A5 稽核 audit_log | §12、R5 | R11 | 每次 query 寫 `km_query` action，含 session_id / 命中 card_ids / 使用 token 數 |
| A6 工研院 RAG 對接 | §10.2、§15 | 🔭 P2+ | 契約未定；本模組**先預留** provider adapter interface，實作用「本地 RAG only」跑通 |
| A7 多模態 source 入庫 | §1-A Whisper/PaddleOCR/BGE-M3 已定案；§1-C C3 素材看板已規劃 | R11 溯源 | 新表 `media_files`；PNG/PDF/XLSX 走 OCR / 表格解析 → 抽 `extracted_text` → BGE-M3 embed；命中後 citation 回連原始檔案 URI |

### 1.3 不做的事

- ❌ **不做工研院 RAG 真串接** — 契約待定（§15 open question），本 module 只留 provider adapter interface + mock adapter，用 stub 資料佔位
- ❌ **不做 LINE 端反向問答** — §1-C C4 group_owner 的 `@bot` 問答是**另一個** module（reply flex message 走 LINE webhook + reply token，路徑跟本 module 不同）
- ❌ **不擴 `knowledge_cards` schema** — 已有 `title / body / entity_tags / source_message_ids / indexed_to_rag`，夠用
- ❌ **不做 RAG 索引重排 / hybrid search** — 首期 BGE-M3 cosine similarity + top-k 就好，rerank 進 P2
- ❌ **不做對話匯出 / 分享 link** — 稽核 audit_log 夠了；匯出是 P2+
- ❌ **不做多輪 memory 壓縮 / summarization** — 首期直接把前 N 輪對話原文帶進 prompt；超過 quota 直接截斷 + 提示使用者「開新對話」
- ❌ **不做多模態內容深層理解** — image / spreadsheet / pdf 走「OCR / 表格解析 → 文字 embed」路線，AI 回答時仍以文字 grounded；不做 vision-native RAG（Claude Vision 分析圖片 = P2+）
- ❌ **不做多模態檔案 in-viewer 編輯 / 標註** — right pane 只 render 預覽，不做 markup / crop / annotation（P2+ 或另 module）

---

## 2. 上游 / 既有現況走查

| 子題 | 上游現況 | Gap |
|---|---|---|
| `knowledge_cards` 資料表 | 🔨 P1（`docs/台灣福祉_系統設計文件_開發用.md` §3 已定 schema） | 尚無 migration；本 module 順帶建 |
| BGE-M3 向量索引 | 🔨 P1 地端（`§1-A [10] RAG 索引`）| 尚無 embedding service；本 module 提供最小可用（單機 in-process 或 pgvector） |
| KM 抽取 pipeline | 🔨 P1（§7.4）| 尚無實作；本 module 只做 query 端，不動 KM 產生端。若無 knowledge_cards 資料，query 走 tickets fallback |
| Claude API 客戶端 | ✅ POC 跑通（`src/classify.ts`）| 需複用 client，但 prompt / structured output schema 是新的 |
| `POST /rag/conversations` endpoint | 沒有 | 全新做 |
| 前端 UI（兩窗格 · 多模態 source viewer） | ✅ `web/src/Rag.tsx` v2 已跑通（左 chat + 右 sources · 支援 image / spreadsheet render）| 換掉 `RAG_QA` fixture → `POST /rag/conversations/:id/messages`；引入 `media_files` metadata |
| `media_files` 資料表 | 沒有；§1-A + §1-C C6 素材看板規劃走多模態管線 | 全新建；本 module 負責 query 側（讀取＋embed 命中）；產生側（OCR/parse/embed）留給 KM 抽取 module |
| PaddleOCR / 表格解析 pipeline | 🔨 P1（§1-A、§7）| 尚無實作；產生端不做（另 module）；本 module 假設 `media_files.extracted_text` 已備妥 |
| `audit_log` 表 | 部分（seed 有欄；尚無 write path）| 本 module 補 `action='km_query'` writer |
| RLS on knowledge_cards / conversations | RLS pattern 已有（tickets / departments）| 沿用相同 policy pattern |

---

## 3. 剩餘 scope 切分

| 子題 | 內容 | 估算 |
|---|---|---|
| **A1 資料模型** | migration 0003：conversations / conversation_messages / knowledge_cards / **media_files** + RLS + index | 0.04 mo |
| **A2 檢索管線** | RagRetriever（BGE-M3 embedder + top-k over knowledge_cards + media_files）+ provider adapter interface（local + itri stub）| 0.08 mo |
| **A3 API** | `POST /rag/conversations` + `POST /rag/conversations/:id/messages` + `GET /rag/conversations` (list) + `GET /rag/media/:id` (檔案取用) + zod schema + guard | 0.05 mo |
| **A4 Claude 合成 prompt** | system prompt + user prompt with citations context；structured output zod schema（answer + citations + followup）| 0.04 mo |
| **A5 前端接 API** | Rag.tsx 換掉 mock；conversation state / session persistence（localStorage）；載入中/錯誤態；打字動畫保留；兩窗格佈局既有 | 0.03 mo |
| **A6 audit_log write** | KM query interceptor + write audit_log entry | 0.02 mo |
| **A7 成本與 quota** | 租戶 daily quota + 每 session 上限（tenant_settings 已有 quota tokens；補 quota check middleware）| 0.02 mo |
| **A8 多模態 render** | 前端 `SourceView` 已支援 6 種 kind（image / spreadsheet / ticket / km / message / external）；後端只補資料形狀（URL / table json / snippet），render 邏輯不動 | 0.01 mo |

**合計**：M1+M2+M3+M4 = **0.29 mo**（約 5-6 工作天）

---

## 4. A1 資料模型

### 4.1 SQL Migration `0003_rag_conversations.sql`

```sql
-- knowledge_cards（若前面 migration 尚未建）
CREATE TABLE IF NOT EXISTS knowledge_cards (
  card_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(department_id) ON DELETE SET NULL,
  ticket_id uuid REFERENCES tickets(ticket_id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL,
  entity_tags text[] DEFAULT '{}',
  source_message_ids uuid[] DEFAULT '{}',   -- 反查原始 LINE 訊息
  embedding vector(1024),                    -- BGE-M3 output dim（需 pgvector extension）
  indexed_at timestamptz,                    -- 索引完成時間；為 null 表示 pending
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_km_tenant ON knowledge_cards (tenant_id);
CREATE INDEX IF NOT EXISTS idx_km_dept ON knowledge_cards (department_id);
CREATE INDEX IF NOT EXISTS idx_km_embed ON knowledge_cards USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE knowledge_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY p_km ON knowledge_cards USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) = 'aiproot_admin'
);

-- conversations（一個對話 session）
CREATE TABLE rag_conversations (
  conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title text,                                    -- 首則問題前 40 字自動生成
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conv_tenant_user ON rag_conversations (tenant_id, user_id, last_message_at DESC);

ALTER TABLE rag_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY p_conv ON rag_conversations USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
);

-- conversation_messages（每輪對話一列 user + 一列 ai）
CREATE TABLE rag_conversation_messages (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES rag_conversations(conversation_id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  citations jsonb DEFAULT '[]'::jsonb,           -- [{id, kind, ref, title, source, snippet}]
  followup text,                                 -- assistant 才有；追問文字
  token_input int,                               -- assistant 才有
  token_output int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_msg_conv ON rag_conversation_messages (conversation_id, created_at);

ALTER TABLE rag_conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_conversation_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY p_msg ON rag_conversation_messages USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
);

-- media_files（多模態源：PNG / JPG / PDF / XLSX / CSV / MP4）
CREATE TABLE media_files (
  file_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(department_id) ON DELETE SET NULL,
  ticket_id uuid REFERENCES tickets(ticket_id) ON DELETE SET NULL,       -- 若源自 ticket
  raw_message_id uuid,                                                    -- 若源自 LINE 訊息（另表，FK 略）
  file_name text NOT NULL,
  file_kind text NOT NULL CHECK (file_kind IN ('image','spreadsheet','pdf','video','audio')),
  mime_type text NOT NULL,
  storage_uri text NOT NULL,                          -- 地端物件儲存 URI（MinIO 或本機路徑）
  extracted_text text,                                -- OCR / 表格解析 / 影像描述輸出
  table_json jsonb,                                   -- spreadsheet 專用：{headers:[], rows:[[]]}
  embedding vector(1024),                             -- 對 extracted_text embed
  entity_tags text[] DEFAULT '{}',                    -- 對應人員 / 車號 / 工單 ID
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_tenant_dept ON media_files (tenant_id, department_id);
CREATE INDEX idx_media_embed ON media_files USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100)
  WHERE embedding IS NOT NULL;

ALTER TABLE media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_files FORCE ROW LEVEL SECURITY;
CREATE POLICY p_media ON media_files USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  OR current_setting('app.actor_role', true) = 'aiproot_admin'
);
```

**依賴**：需要 `CREATE EXTENSION IF NOT EXISTS vector`（pgvector）— dev 環境用 `pgvector/pgvector` docker image 或 apt install postgresql-16-pgvector；prod 由人手動 install（R10）。

### 4.2 TypeScript schema（drizzle）

補進 `server/src/db/schema.ts`：對照上面 SQL 一對一（略）。

---

## 5. A2 檢索管線

### 5.1 元件圖

```
POST /rag/conversations/:id/messages
       │
       ▼
QuotaGuard (租戶 daily quota + session 輪次)
       │
       ▼
RagRetriever
   ├─ embed(question)   → BGE-M3 (地端 HTTP service 或 in-process)
   ├─ pgvector KNN top-k=6 於 knowledge_cards.embedding
   ├─ pgvector KNN top-k=3 於 media_files.embedding      ← 多模態源（PNG/PDF/XLSX 之 OCR/parse 文字）
   ├─ tickets full-text fallback（若 KM+媒體命中 < 3）
   └─ ItriRagAdapter.query（if department.line_group_id == 技術研發群）
       │
       ▼
CitationsBuilder
   ├─ card / ticket → 帶出 source_message_ids → 抓 raw_messages 摘要
   └─ media_files → 附 storage_uri + 依 file_kind 帶出 render payload：
        · image      → { caption, thumbnail_uri }
        · spreadsheet→ { table_json (headers/rows), sheet_names[] }
        · pdf        → { page_count, preview_text }
        · video      → { duration_sec, thumbnail_uri }
       │
       ▼
Claude synthesize（Sonnet 4.6，structured output）
   ├─ system prompt：中文回答；每句必掛 [n] cite；不臆測
   ├─ user prompt：previous_messages + retrieved_docs + question
   │   （多模態源 embed 進 prompt 時只帶 extracted_text，不塞 binary）
   └─ output zod: { answer: string(含 [n] 標記), citations: Citation[], followup?: string }
       │
       ▼
Persist（rag_conversation_messages）+ audit_log (action='km_query')
       │
       ▼
Response（前端右窗格依 citation.kind 分派 renderer）
```

### 5.2 Provider adapter interface

```typescript
interface RagProvider {
  readonly kind: 'local' | 'itri';
  query(input: {
    tenantId: string;
    departmentIds: string[];    // RLS 範圍
    question: string;
    topK: number;
  }): Promise<RetrievedDoc[]>;
}

interface RetrievedDoc {
  source: 'knowledge_card' | 'ticket' | 'raw_message' | 'itri' | 'media_file';
  refId: string;                 // card_id / ticket_id / message_id / itri external id / file_id
  title: string;
  snippet: string;               // 200-500 字擷取（media_file 用 extracted_text 開頭）
  score: number;                 // 0..1
  metadata: {
    departmentId?: string;
    messageIds?: string[];
    createdAt?: string;
    itriDocId?: string;
    // media_file 專用
    fileKind?: 'image'|'spreadsheet'|'pdf'|'video'|'audio';
    fileName?: string;
    storageUri?: string;
    tableJson?: { headers: string[]; rows: string[][] }; // spreadsheet
    caption?: string;                                     // image / video
    thumbnailUri?: string;
  };
}
```

首期兩個實作：`LocalRagProvider`（pgvector + tickets fallback）、`ItriRagStubProvider`（回傳固定 2 筆假的工研院條目，等 §15 契約定案再 swap）。

### 5.3 Prompt（system）

```
你是 aiproot 戰情室的智慧檢索助手。使用者是台灣的工廠管理階層或群組負責人。

規則：
1. 一律用繁體中文簡潔回答（3-6 句），語氣中性
2. 引用來源用 [1] [2] 標記，對應 output.citations 陣列
3. 每個具體事實（人名、時間、車號、規格、法規條）必掛 citation；沒引用的內容視為錯誤
4. 缺資料就明說「本次檢索未涵蓋 X」，不要臆測或生成看似合理的答案
5. 若命中資料反映不同來源不一致，回答時明確指出「A 資料寫 X，B 資料寫 Y」
6. 最後給一則 followup（追問），提出一個能延伸的相關問題

Output 走 structured JSON：{ answer, citations[], followup? }
```

---

## 6. A3 API

### 6.1 Endpoints

| Method | Path | Body | Response | 角色 |
|---|---|---|---|---|
| GET | `/rag/conversations` | — | `{ conversations: [{id, title, last_message_at}] }` | 內容角色 |
| POST | `/rag/conversations` | `{ first_question: string }` | `{ conversation_id, message: AssistantMessage }` | 內容角色 |
| GET | `/rag/conversations/:id` | — | `{ id, title, messages: Message[] }` | 內容角色 |
| POST | `/rag/conversations/:id/messages` | `{ question: string }` | `{ message: AssistantMessage }` | 內容角色 |
| DELETE | `/rag/conversations/:id` | — | `{ ok: true }` | 擁有者 |

### 6.2 zod schemas（`server/src/rag/dto.ts`）

```typescript
export const CitationSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['knowledge_card','ticket','raw_message','itri','image','spreadsheet','pdf','video']),
  ref: z.string(),
  title: z.string(),
  source: z.string(),
  snippet: z.string(),
  // 多模態專用（依 kind 出現）
  storageUri: z.string().url().optional(),          // image / pdf / video
  thumbnailUri: z.string().url().optional(),        // image / video
  caption: z.string().optional(),                   // image / video
  table: z.object({                                  // spreadsheet
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    sheetNames: z.array(z.string()).optional(),
  }).optional(),
  pageCount: z.number().int().optional(),           // pdf
  previewText: z.string().optional(),               // pdf
  durationSec: z.number().optional(),               // video
});
export const AssistantMessageSchema = z.object({
  message_id: z.string().uuid(),
  role: z.literal('assistant'),
  content: z.string(),
  citations: z.array(CitationSchema),
  followup: z.string().nullable(),
  created_at: z.string(),
});
```

### 6.3 Controller pattern（複用既有）

- `@Roles('tenant_admin','group_owner','consultant','aiproot_admin')` guard
- `@CurrentUser()` decorator 拿 tenantId + userId
- 每個 endpoint 在 `withTenant()` transaction 內執行，讓 RLS 生效
- `QuotaGuard` interceptor：先查 `rag_quotas` 表當日用量

### 6.4 UI 佈局規範（兩窗格 · NotebookLM 風）

**Layout**：
- 全頁 pane 內走 `.rag-shell` grid `1fr 460px`（左 chat + 右 sources；hairline 分隔）
- 高度 `calc(100vh - topbar - pane padding - header)`；左右各自獨立捲動

**左窗格（`.rag-chat`）**
- Body：對話 bubbles + typewriter 動畫
- 底部：建議 chips（`RAG_QA` 剩餘題） + input row（純文字輸入 + 送出 button）
- Inline citation `[n]` 為 chip 按鈕，active 態反色

**右窗格（`.rag-sources`）三態**：

| 態 | 觸發 | 內容 |
|---|---|---|
| **empty** | 尚無 messages | 「先問一個問題」文案 + 引導 hint |
| **list** | 有 messages，未選 citation | 本次對話累計引用清單（去重）· 每筆 kind icon + title + ref |
| **detail** | 選中某 citation（點 `[n]` 或引用卡） | `SourceView` 依 `kind` 分派 renderer |

**`SourceView` renderer 對照**：

| kind | Renderer | 內容 |
|---|---|---|
| `knowledge_card` / `ticket` / `raw_message` / `itri` | `<TextSnippet>` | snippet 段落 |
| `image` | `<ImageMock>` | inline SVG（demo）／ `<img src={storageUri}>`（prod） + caption |
| `spreadsheet` | `<SpreadsheetMock>` | HTML `<table>` render `table.headers` + `table.rows`；含 sheet tabs / 序號欄 / 頁尾統計 |
| `pdf` | `<PdfPreview>` | `previewText` + page 指示 + 下載 button (P2) |
| `video` | `<VideoPreview>` | thumbnail + duration + play button (P2) |

**回上一態**：`detail` → 「← 全部來源」button 回 `list`；`list` → 無需回 button，重新問問題即累計

**雙向 highlight**：selected citation 在左邊 chip 與引用卡都套 `.active`（primary tint 底）；右邊 detail header 顯示對應 kind icon + title

**Empty state 例外**：若 message 存在但都無 citation（fallback answer），right pane 顯示「本次檢索未命中資料」

**現況 mock 已實作**：`web/src/Rag.tsx` v2 + `web/src/mockdata/ragQA.ts` 含 2 筆多模態 fixture（Q1 [3] 升降機圖紙 png、Q4 [3] 7月工時 xlsx）

---

## 7. 資料模型變動

### 7.1 SQL Migration `0003_rag_conversations.sql`

- 新表：`rag_conversations`、`rag_conversation_messages`、`knowledge_cards`（若前面沒建）、**`media_files`**
- Extension：`pgvector`
- RLS：四張表都 FORCE，tenant_id 對齊 `app.current_tenant`
- Index：
  - `ivfflat vector_cosine_ops` 於 `knowledge_cards.embedding`
  - `ivfflat vector_cosine_ops` 於 `media_files.embedding`（`WHERE embedding IS NOT NULL` partial index，避免 pending 索引拖累）
  - `(tenant_id, user_id, last_message_at DESC)` 於 `rag_conversations`
  - `(tenant_id, department_id)` 於 `media_files`

### 7.2 前端 API client

`web/src/api.ts` 補：

```typescript
export const listRagConversations = () => req<{ conversations: RagConversationMeta[] }>('/rag/conversations');
export const startRagConversation = (firstQuestion: string) =>
  req<{ conversation_id: string; message: AssistantMessage }>('/rag/conversations', { method: 'POST', body: JSON.stringify({ first_question: firstQuestion }) });
export const askInConversation = (id: string, question: string) =>
  req<{ message: AssistantMessage }>(`/rag/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ question }) });
// 多模態原檔取用（image / pdf / video）— 走簽章 URL 有時效；spreadsheet 資料直接內嵌 citation.table 不走此 endpoint
export const getMediaFileUrl = (fileId: string) => `/api/rag/media/${fileId}`;   // 302 → 簽章 URL
```

### 7.3 RLS / Permission

- tenant_admin：看得到全租戶 conversations + 全 department 的 knowledge_cards + 全 department 的 media_files
- group_owner：只看本 department 的 knowledge_cards + media_files；conversations 只看自己開的
- consultant：限指派租戶內；查詢範圍與 tenant_admin 同
- aiproot_admin：跨租戶（有 `app.actor_role='aiproot_admin'` 加持）

由 `POST /rag/conversations/:id/messages` 內部 `RagRetriever` 呼叫時，`departmentIds` 是根據 role 計算：

- tenant_admin: 所有 dept
- group_owner: 只本 dept
- consultant: 依指派租戶內所有 dept
- aiproot_admin: 跨租戶（少見；限單獨呼叫）

**媒體檔案原檔取用**（`GET /rag/media/:file_id`）：RLS 通過後回 302 → 地端物件儲存（MinIO / 檔案系統）的**簽章 URL 有時效**（5 分鐘），防止 URL 被外流長期使用。

---

## 7-bis. 企業級 cross-cutting 檢核（Mode B）

### 7-bis.1 安全模型

| 攻擊面 | 緩解 | 對應實作 |
|---|---|---|
| 跨租戶檢索（RLS 繞過）| PolicyGuard + `FORCE RLS` + withTenant tx | `rag_conversations` / `knowledge_cards` policy |
| Prompt injection（問題內含指令）| System prompt 明確不從 user content 接受指令；結構化 output（zod）限制格式 | `RagSynthesizeService.buildPrompt` |
| Data exfiltration via followup | Followup 也走同 citation 驗證；不能含 raw ticket id 未 cite | zod schema 檢 followup 內字元 |
| Excessive token spend | QuotaGuard 每 tenant daily cap + 單次 session 輪次 cap | `rag_quotas` 表 + interceptor |
| Log injection via question | 存 DB 前 `text` 欄位不做 shell / SQL；audit_log 記 hash + first 200 char | Controller |
| 媒體檔 URL 外流長期使用 | `GET /rag/media/:id` 回 302 → 簽章 URL 5 分鐘 TTL；RLS 通過才簽 | `MediaFileController.serve` |
| 惡意檔上傳（未來 upload endpoint）| MIME 白名單 + magic bytes 檢查；掃毒（P1+）| Ingest 端 module 負責，本模組假設已檢 |

Input validation：`question` max 500 字元 + 去 zero-width + trim；conversation_id UUID v4 格式驗證。

### 7-bis.2 容量

- 預估 QPS：normal 0.1 / peak 2（多輪對話 burst）
- 每輪 assistant response 存 db：~2KB × 2000 rows/day/tenant = 4MB/day/tenant → 一年 1.5GB/tenant
- knowledge_cards embedding vector 1024 dim × 4 bytes = 4KB/row；預估 5000 cards/tenant → 20MB/tenant
- media_files embedding + extracted_text：~4KB embed + ~10KB text/檔 → 預估 2000 files/tenant → 28MB/tenant
- 媒體檔原檔（不進 embed，走物件儲存）：PNG ~500KB、XLSX ~200KB、PDF ~1MB、MP4 ~50MB；預估 2000 files/tenant 平均 3MB → 6GB/tenant
- 單次檢索 top-6+3 + Claude synthesize：500ms embed + 150ms pgvector（併 2 表 KNN）+ 1.5s Claude ≈ 2.15s
- pgvector KNN with ivfflat lists=100：對合計 7000 rows 大概 8ms（合理）

### 7-bis.3 失效模式

| 路徑 | Timeout | Retry | Circuit breaker | Fallback |
|---|---|---|---|---|
| BGE-M3 embed | 5s | no retry | 3 fail → 60s open | 回覆「檢索服務暫時不可用，請稍後再試」 |
| pgvector KNN | 2s | no retry | n/a | 走 tickets full-text fallback |
| Claude synthesize | 30s | exp backoff × 1（SDK 內建 429/5xx）| SDK 內建 | 存 `error` status message，前端顯示「AI 生成失敗，請重試」 |
| ItriRagAdapter | 5s | no retry | 若 3 fail → 該 provider 暫時停用 30 分 | 忽略工研院來源，走本地 |
| audit_log write | 100ms | no retry | n/a | 記錯不影響主流程，但寫 warning log |

### 7-bis.4 觀測性

| 類型 | 名稱 | 用途 |
|---|---|---|
| counter | `rag_request_total{tenant, role}` | 流量 |
| histogram | `rag_request_duration_seconds{phase=embed|knn|synthesize}` | latency 分段 |
| histogram | `rag_tokens{direction=input|output}` | 成本追蹤 |
| counter | `rag_errors_total{reason}` | 錯誤分類（quota_exceeded / llm_timeout / retrieval_empty） |
| counter | `rag_citations_per_answer` | grounded 品質 |
| counter | `rag_media_hits_total{kind}` | 多模態命中分佈（image / spreadsheet / pdf 各佔比）|
| histogram | `rag_media_serve_duration_seconds` | `GET /rag/media/:id` 302 簽章延遲 |
| structured log | `rag.query` action | audit_log 內；含 tenantId / userId / questionHash / hitCardIds |
| alert | `rag_error_rate > 10% for 10min` | severity=page |
| alert | `rag_daily_tokens > 80% of tenant quota` | severity=warn；提示需要 upgrade |

### 7-bis.5 資料生命週期

- Retention：conversations 保留 90 天；到期 daemon 軟刪（title 保留、messages 刪）
- PII 標記：question 可能含員工姓名（去識別已在 §6 上游處理，但 RAG 端不再一次；conversation 屬 tenant 資產）
- Right-to-erasure：用戶請求刪帳號 → cascade 刪 conversations + messages（tenant 內）
- Encryption：at rest（PG TDE 或磁碟加密）；in transit HTTPS
- Embedding：只存於本地 pgvector，不跨區

### 7-bis.6 向後兼容 + Rollout

- Proto 變更：無（直接建新 endpoint）
- API versioning：`/rag/conversations` 是新 endpoint，無 breaking
- Migration rollback：`0003_rag_conversations.down.sql` drop 三張新表 + 移除 pgvector extension（若無其他用戶）
- Feature flag：`tenant_settings.rag_enabled boolean DEFAULT false`；per-tenant 開啟；kill switch = 全域 env var `RAG_KILL_SWITCH=1`

### 7-bis.7 成本模型

以 1 個租戶 · 20 daily-active users · 每人每天 5 次 query 假設（100 queries/day）：

| 資源 | 增量 | 月成本量級 |
|---|---|---|
| Claude Sonnet 4.6 input | ~2000 tok/query × 100/day × 30 = 6M tok/mo | $18 / mo |
| Claude Sonnet 4.6 output | ~400 tok/query × 100/day × 30 = 1.2M tok/mo | $18 / mo |
| BGE-M3 embed | 地端，攤入 GPU 成本 | ~ $0 增量 |
| PG storage | ~4MB/day × 30 + 28MB media meta = 148MB/mo | negligible |
| 物件儲存（媒體原檔）| 平均 6GB/tenant | ~$0.6 / mo（MinIO 地端；未來換 S3 才有增量）|
| pgvector query | 地端 CPU（2 表 KNN）| negligible |

**單租戶月成本**：~$36 / mo 於 20 DAU × 5 queries/day 基準。10 個租戶 = $360 / mo。工研院 RAG 契約收費另計（未定）。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | RagRetriever（top-k merge / dedup）、CitationsBuilder（source_message_ids → snippet 對應）、SynthesizePrompt 生成 | `server/test/rag/*.test.ts` |
| Integration | POST /rag/conversations 完整走通 + RLS 交叉租戶驗證 | `server/test/rag/integration.test.ts` |
| Contract | Provider adapter 兩個實作（Local / ItriStub）都通 shared test suite | `server/test/rag/provider.test.ts` |
| Frontend | Rag.tsx integrates real API + error / loading states | 手動 walk-through |

至少 **12 個 unit tests + 4 個 integration tests**。

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 預估 | 狀態 |
|---|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED（用戶定 OQ-RAG-1..7）| 0.02 mo | ⏳ |
| **M1** 資料層 | migration 0003 + pgvector setup + drizzle schema + RLS 測試 | 0.04 mo | ⏳ |
| **M2** 檢索管線 | RagRetriever + LocalRagProvider + ItriRagStubProvider + CitationsBuilder + unit tests | 0.08 mo | ⏳ |
| **M3** API + Claude synthesize | Controller + DTO + Claude client + synthesize service + integration tests | 0.06 mo | ⏳ |
| **M4** 前端接通 | Rag.tsx 換掉 mockdata → API client；session 持久化；載入/錯誤態；docs → v1.0 + MODULES.md → ✅ | 0.03 mo | ⏳ |
| **M5** FMEA 收尾（R17）| 填 §12 失效場景反思（逐路徑 → 嚴重度 → 緩解）；P0 未緩解不得上 prod | 0.02 mo | ⏳ |

---

## 10. 開放問題（OQ-RAG-N）— 待裁定

| # | 訴求 | 議題 | 選項 | 建議 |
|---|:-:|---|---|---|
| **OQ-RAG-1** | ② | pgvector 走地端 in-process 還是獨立 embedding service？ | A. 直接把 BGE-M3 python 塞進 sidecar container，走 REST（`localhost:8001/embed`）<br>B. 用 pgvector + PG 內建 embedding function（不現實，PG 沒 BGE-M3）<br>C. 雲端 embedding API（違反地端原則） | **A** — 保地端信任邊界；sidecar 好維護 |
| **OQ-RAG-2** | ① | 對話首輪自動命名 title 誰生？ | A. 用戶手動命名（多摩擦）<br>B. 前 40 字自動截取<br>C. Claude 生成（多一次 API call）| **B** — 便宜、可預期；C 是 P2 選項 |
| **OQ-RAG-3** | ② | 「多輪 context」該如何 propagate 到下一輪 prompt？ | A. 全塞（首期簡單，但 token 費會漲）<br>B. 保留最近 3 輪 user + 3 輪 assistant（截斷）<br>C. 每輪由 Claude summarize 前文（多一次 call）| **B** — 簡單有效；超過提示使用者「開新對話」 |
| **OQ-RAG-4** | ③ | 首期 quota policy？ | A. 每 tenant daily 100 queries + 每 session max 20 輪<br>B. 依帳號分級（demo / trial / paid）<br>C. 不限量（早期 free） | **A** — 給明確上限，超過 429 顯示中文訊息；分級留給計費 module |
| **OQ-RAG-5** | ④ | 工研院 RAG adapter 首期怎麼 stub？ | A. 回固定 2 筆假的技術研發相關條目（demo 可展示）<br>B. 完全不出現這條 citation（前端已有預錄 mock）<br>C. 空實作，等契約定案 | **A** — 讓 demo 可秀「外部知識庫接入」的價值，前端也已有 mock 對應 |
| **OQ-RAG-6** | ① | Followup 追問點下去，是續問（同 session）還是新開 session？ | A. 續問（同 session 新一輪）<br>B. 新開 session（followup 帶進 new conversation 的首問）<br>C. 讓使用者選 | **A** — 保留 context；符合原 Perplexity / ChatGPT 慣例 |
| **OQ-RAG-7** | ③ | conversation retention 90 天到期怎麼處理？ | A. 硬刪整筆<br>B. 軟刪（title 保留、messages 刪）→ 保 audit_log 佐證<br>C. 匯出後刪 | **B** — 中庸；主管仍可看歷史流量，但敏感內容清了；R11 溯源靠 audit_log 補 |
| **OQ-RAG-8** | ② | 多模態檔案（PNG / XLSX / PDF / MP4）怎麼進 RAG 索引？ | A. **OCR / 表格解析** → 抽 `extracted_text` → BGE-M3 embed → 命中後 citation 回連原檔（正解，可 grounded）<br>B. 只用 `entity_tags` + `file_name` + 人工描述 embed（不 parse 內容；命中 loose）<br>C. Demo-only：純 metadata match，不進 RAG 索引（現況）<br>D. Vision-native RAG（Claude Vision 直接分析圖片；P2+） | **A** — 治本；讓「7月工時 xlsx 內某一筆」也能被答案精準定位。實作端 OCR 用 PaddleOCR（§1-A 已定案）、表格解析用 openpyxl / pandas；抽出的 text 掛 metadata 標檔案 offset（e.g. `sheet:工作表1,row:5`）方便日後回連。B/D 屬 P2+ 演進方向 |

---

## 11. SOP — 日常操作

### 11.1 開啟一個租戶的 RAG 功能

1. 進 aiproot 內部管理後台 → 租戶清單 → 選中租戶
2. 設定 → 進階功能 → 開啟「智慧檢索 RAG」toggle
3. 系統自動：（a）建 pgvector index（若首開啟）（b）觸發歷史 knowledge_cards 補建 embedding batch job
4. 預期：24 小時內完成初始化；租戶端 sidebar「智慧檢索」module 從隱藏變可用

### 11.2 失敗模式排查

| 症狀 | 含意 | 處置 |
|---|---|---|
| 前端「無法檢索」toast，5xx | Claude / BGE-M3 / pgvector 其一掛 | 查 `rag_errors_total{reason}` label 定位 |
| 回答不引用來源 | prompt 沒生效或 output schema 沒抓到 citations | 檢查 rag_conversation_messages 該 row citations 是否空；抓 dev log 看 Claude raw output |
| Quota exceeded | 429 | 查 `rag_quotas` 表；升等或次日重置 |
| 檢索命中太少（總是 fallback） | knowledge_cards 空 / embedding 未 index | 檢查 `knowledge_cards where indexed_at is null` 數量；跑補 index batch |
| 跨租戶疑慮 | RLS 沒生效 | 立刻 `SELECT * FROM pg_policies WHERE tablename='rag_conversations'` 確認；跑 `server/test/rag/integration.test.ts` |

### 11.3 審計查詢

```sql
-- 過去 7 天某租戶所有 km_query
SELECT ts, actor_user_id, target_id AS conversation_id, meta->>'question_hash' AS q_hash, meta->'hit_card_ids' AS hits
FROM audit_log
WHERE tenant_id = $1 AND action = 'km_query' AND ts > now() - interval '7 days'
ORDER BY ts DESC;

-- 過去 30 天 token 消耗前 10 名使用者
SELECT actor_user_id, SUM((meta->>'token_input')::int + (meta->>'token_output')::int) AS total_tokens
FROM audit_log
WHERE action = 'km_query' AND ts > now() - interval '30 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
```

---

## 12. 失效場景反思（FMEA）— 收尾必填（R17）

> **狀態：待 M4 收尾時填齊**

### 12.1 POST /rag/conversations/:id/messages（主流程）

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| Q1 | 跨租戶 conversation_id 猜測 | RLS block → 404 | ⏳ 待 M5 驗證 | P0 |
| Q2 | question 含 prompt injection「忽略前面規則」 | Claude 依 system prompt 守規；structured output schema 擋 | ⏳ | P1 |
| Q3 | Claude API 30s 超時 | 30s timeout → 5xx → 前端「AI 生成失敗，請重試」 | ⏳ | P1 |
| Q4 | Quota 用完 | 429 → 前端友善訊息「今日檢索次數用完」 | ⏳ | P2 |
| Q5 | knowledge_cards 空，tickets 也空 | 回傳「本次檢索未命中資料，建議調整問題方向」；不強行生成 | ⏳ | P2 |
| Q6 | 兩個並發 message 進同一 session | conversation `last_message_at` race；messages 各自 insert 無 conflict | ⏳ | P2 |
| Q7 | Group owner 問到跨部門的問題 | 檢索範圍 RLS 只給本部門 → 資料量少可能不夠回答 → 明說「本部門無相關資料」 | ⏳ | P1 |
| Q8 | Claude 回答不加 citation | structured output zod 檢查 `answer` 至少含一個 `[n]` 標記；缺 → retry once + log warning | ⏳ | P1 |
| Q9 | 媒體檔 storage_uri 失效（檔案被刪 / MinIO 掛）| citation 仍出現，但 GET /rag/media/:id → 404 → 前端 renderer 秀「原檔無法載入」+ fallback 到 snippet 文字 | ⏳ | P1 |
| Q10 | Spreadsheet table_json 過大（>500 rows）| 前端 render 卡頓 | ⏳（截 100 rows + 「下載完整檔」button）| P2 |
| Q11 | media_file 已上傳但 embedding 未 index | RagRetriever 略過（`WHERE embedding IS NOT NULL`）；批次補 index job 補齊 | ⏳ | P2 |
| Q12 | XSS via file_name / caption（含 script tag）| React 自動 escape；不用 dangerouslySetInnerHTML | ✅ 由框架保障 | P1 |

### 12.2 部署順序

| # | 場景 | 風險 | 緩解 |
|---|---|---|---|
| D1 | 後端先於 migration 部署 | rag_conversations 表不在 → 500 | migration 必先（R10 人工跑 + 手動確認 rag_* 表存在） |
| D2 | pgvector extension 未 install | migration 失敗（`vector` type not found）| pre-check step：`SELECT * FROM pg_extension WHERE extname='vector'` |
| D3 | 前端先於後端 endpoint 部署 | 404 → api.ts 顯示「找不到對應資料」 | 部署順序：後端 → 前端；或 tenant_settings.rag_enabled=false 隱藏 module |
| D4 | Feature flag rag_enabled=true 但 embedding 未建 | 檢索命中 0 → fallback tickets full-text | 首次開啟先跑 batch 建 embedding，完成才開 tenant flag |
| D5 | MinIO / 物件儲存未就緒但 rag_enabled=true | media citation 有但原檔 404 | pre-check：`MinioHealthCheck` 綠燈才允許啟用 rag_enabled |

### 12.3 不在本 module scope 修的 pre-existing 問題

- KM 抽取 pipeline（§7.4）本 module 不做；若 knowledge_cards 是空的，走 tickets fallback，功能仍可用但品質降。開單：`docs/modules/km-extraction.md`（未建）
- 工研院 RAG 契約（§15 open question）本 module 只 stub；契約定案後再開新 module `docs/modules/itri-rag-integration.md`
- LINE 端反向問答（§1-C C4）獨立 module
- 多模態**產生端**（PaddleOCR / XLSX parse / 影像描述 → 寫入 media_files.extracted_text + embedding）本 module 不做，屬 KM 抽取 pipeline 範疇；本模組只做**查詢端** consume media_files 表。若表空 → 前端 SourceView 依舊 render 但只走文字 snippet path
- 素材看板（§1-C C3 「多模態素材看板」）獨立 module；與本模組共用 media_files 表，但 UI 走 grid view 不走 chat drawer 對照。開單：`docs/modules/media-library.md`（未建）

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-04 | v0.1 | 初版 DRAFT — sub-task A1-A7 + OQ-RAG-1..7；對齊 `台灣福祉_系統設計文件_開發用.md` §7.4 / §10.1 / §1-C C3 / B3-3 | Claude Code |
| 2026-07-04 | v0.2 | 補多模態 + 兩窗格 UI：（1）CitationSchema kind 擴 image/spreadsheet/pdf/video（2）新增 `media_files` 表 + pgvector index（3）§5.1 RagRetriever 加 media_files KNN path（4）RetrievedDoc 加 fileKind/tableJson/storageUri metadata（5）新 §6.4 兩窗格 UI 佈局規範 + SourceView renderer 對照表（6）新 sub-task A8 多模態 render（7）新 OQ-RAG-8 多模態入庫策略（建議 A · OCR/parse → BGE-M3 embed）（8）§7-bis 補 storage 成本 / 簽章 URL / rag_media_hits 觀測 / 惡意檔上傳（9）§12 FMEA 加 Q9-Q12 + D5 場景（10）§12.3 開素材看板 module 單。前端 `web/src/Rag.tsx` v2 mock 已跑通對應 UI | Claude Code |
