# phase1-live-loop.md — [P1] 台灣福祉一條龍 Live Loop 設計文件

> ✅ **狀態：APPROVED — OQ-P1-1..8 全數採建議裁定（2026-07-04）；進入 M1**
>
> Phase 1 目標：把 POC 已驗證的分析管線，接成一條**可上線的即時迴圈**——訊息 → 去識別 → AI 抽取 → 負責人簽核 → 匯流 Ragic → 戰情室呈現，先讓**首個實客台灣福祉**真的用起來。本檔為傘狀 M0：切分 Phase 1 範圍、把架構/範圍岔路整理成 OQ 給用戶裁定；**細節設計引用** `docs/台灣福祉_系統設計文件_開發用.md`（下稱「系統文件」），不重複。
>
> 作者：Claude Code（草擬）｜版本：v0.1（2026-07-04）

---

## 1. 目標與範圍

### 1.1 目標
1. **一條龍跑通（台灣福祉）**：訊息進（先匯出檔上傳、後 LINE webhook）→ 去識別 → AI 抽取 → tickets → 負責人簽核 → 匯流 Ragic → 戰情室即時呈現。
2. **租戶隔離從第一天**：所有業務表帶 `tenant_id` + PostgreSQL RLS；即使首期只有一個租戶，也不留「之後再補隔離」的技術債。
3. **兩個角色可用**：`tenant_admin`（總經理室）＋ `group_owner`（群組負責人）以**真資料**驅動戰情室（非 mockup 靜態）。
4. **誠實鐵律落地**：`source_ids` 可溯源、`confidence` 分級、缺漏 `null`、**簽核後才寫 Ragic**、`audit_log` 全記。

### 1.2 對應 stakeholder 訴求
| 子題 | 主要訴求 | 對應點 |
|---|---|---|
| 一條龍 | 合夥人／台灣福祉：看到「LINE→結構化→簽核→Ragic」真的會動 | §3 M2/M3 |
| 簽核防呆 | 委員／客戶：人未簽核不進 ERP（誠實、可稽核） | 系統文件 §8 |
| 戰情室 | 台灣福祉總經理室：每日營運一頁掌握 | 系統文件 §9、mockup |

### 1.3 不做的事（Phase 1 邊界，防 scope creep）
- ❌ **aiproot / consultant 完整後台**（跨租戶運營、補助漏斗、授權席次）— 延後，首期只有一個租戶。
- ❌ **地端 NER 模型 / Whisper / PaddleOCR**（見 OQ-P1-3、OQ-P1-7）— 先規則遮罩＋純文字。
- ❌ **真 LINE webhook 公開端點**（見 OQ-P1-4）— 先匯出檔上傳跑通後端。
- ❌ **工研院 RAG 同步**（契約未定，系統文件 §15）。
- ❌ **客戶地理地圖**（需台灣福祉 CRM 資料源，系統文件 B4-2）。
- ❌ **SFT 地端模型**（長期地端化，系統文件 §1-A）。

---

## 2. 上游 / 既有現況走查
| 子題 | 上游現況 | Gap |
|---|---|---|
| 解析 LINE 匯出 | ✅ `src/parser.ts`（實跑） | 無 |
| AI 分類抽取 | ✅ `src/classify.ts`（雙租戶 tenant context 已跑通） | 缺「六 department schema 路由」，目前單一 schema |
| 主檔 grounding | ◐ `src/masterData*.ts`（模擬主檔） | Phase 1 改接 Ragic 主檔（OQ-P1-5） |
| 指標聚合 | ✅ `src/warroom/aggregate.ts`（實跑 33/67/62） | 無 |
| 戰情室視圖 | ◐ `src/warroom/render.ts`（靜態 HTML mockup） | 需元件化 + 接 API 真資料 |
| 系統設計（schema/RLS/API/狀態機） | ✅ 系統文件（完整） | 需落地成 code，且待 OQ 裁定 |
| 服務層 / DB / 佇列 | ❌ 無（目前純 CLI） | 全新做（NestJS/PG/Redis/BullMQ） |
| 去識別 | ❌ 無 | 全新做（OQ-P1-3） |

---

## 3. 剩餘 scope 切分（M1–M4）
> 估算以「人日」表示，對齊系統文件 §14 的 16 天總估（Phase 1 垂直切片，非全量）。

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 地基** | docker-compose（PG16/Redis）；schema：tenants/departments/users/tickets/audit_log + RLS policy；NestJS + JWT 中介層（注入 `app.current_tenant/role/department`） | 3 日 |
| **M2 Ingest + 批次抽取** | 匯出檔上傳 API → `raw_messages`；規則去識別（車號/電話/人名→token + `employee_pseudonym_map`）；批次 Worker（BullMQ）重用 `classify` → grounding → upsert `tickets`（冪等） | 4 日 |
| **M3 簽核 + 同步** | 簽核狀態機 API（待簽核→已簽核→逾時；低信心擋）；Outbox（同交易入列）；Ragic adapter（真/模擬可切換，OQ-P1-5） | 3 日 |
| **M4 戰情室 API + 前端** | `/warroom`、`/signoff` API（RLS gated）；`tenant_admin`＋`group_owner` 視圖元件化（重用 render token/邏輯）接真資料；簽核即時重算 | 4 日 |
| **M5 FMEA + 驗收** | §12 逐路徑失效反思；權限/反幻覺/簽核 gate/不外流 E2E（系統文件 §13）；P0 全清才可上 prod | 2 日 |

**合計**：約 16 人日（與系統文件 §14 一致；webhook/多模態/aiproot 為 Phase 1 之後）。

---

## 4. M1 地基（摘要，細節見系統文件 §3/§4）
- **Schema（首期子集）**：`tenants, departments, users, tickets, audit_log`（+ `raw_messages, employee_pseudonym_map, ragic_sync_outbox` 於 M2/M3）。**全部帶 `tenant_id` + RLS 從第一天**（OQ-P1-1）。
- **隔離**：JWT → NestJS guard（RBAC）→ 全域 interceptor `SET LOCAL app.current_tenant/role/department`（同一連線 transaction，Drizzle，不用 Prisma）→ DB RLS（第二道）。
- **交付驗證**：tenant(A) 查 tenant(B) → 403/空（API＋RLS 雙驗）。

## 5. M2 Ingest + 批次抽取（摘要，細節見系統文件 §5/§6/§7）
- **Ingest（Phase 1 先匯出檔上傳）**：`POST /ingest/upload`（.txt）→ `parseLineExport` → `raw_messages(processed=false)`。（webhook 為第二來源，OQ-P1-4）
- **去識別（Phase 1 先規則）**：車號/電話正則 + 人名對照（LINE 顯示名 → `EMP_*`）；寫/查 `employee_pseudonym_map`；**對照表不出地端**。（NER 模型 OQ-P1-3）
- **批次**：BullMQ job（冪等鎖）→ 去識別 → department 路由（OQ 需確認六群 schema）→ 重用 `classify`（雲端 Claude，吃去識別文本）→ grounding 還原 token → upsert `tickets`（`source_message_ids` 去重）。

## 6. M3 簽核 + 同步 / M4 戰情室（摘要，細節見系統文件 §8/§9/§10）
- **簽核**：狀態機（待簽核→已簽核→逾時；`needs_review` 低信心須補件才可簽）；`/signoff` 確認 → 同交易 INSERT Outbox。
- **同步**：sync worker `FOR UPDATE SKIP LOCKED` → Ragic adapter；失敗指數退避、顯示「同步失敗」徽章、不回退簽核。
- **戰情室**：`/warroom`（三環＋六群＋KPI，依 role 過濾）、`/signoff`；前端把 `render.ts` 的 blueprint token/元件化，接 TanStack Query；簽核後 refetch 即時重算。

---

## 7. 資料模型變動
- **7.1 SQL Migration**：新建系統文件 §3 的表（Phase 1 子集，見 §4）。每表 `up.sql`/`down.sql`；**migration 必先於後端 code（R10 人工執行）**。
- **7.2 RLS**：`tickets` 等啟用 RLS（系統文件 §4.3）；aiproot 聚合走 `v_tenant_health`（首期不建 aiproot UI，但 VIEW 可先備）。
- **7.3 既有 code**：`classify.ts` 的 tenant context 機制（本 session 已加）延用；`masterData*` 於 M2 由 Ragic 主檔或 seed 取代。

---

## 7-bis. 企業級 cross-cutting 檢核（本 session 為 Mode A，摘要；逐里程碑補齊）
> 完整檢核見系統文件；此處只標 Phase-1-specific 重點。
- **安全**：信任邊界＝只有去識別文本＋遮罩圖上雲（系統文件 §1、§13「不外流」測試）。**⚠ 上 prod 前去識別必須完整（P0，見 §12）**。
- **容量**：首期單租戶、每日批次一次、六群組；量級極小。PG 單機足夠。
- **失效**：Claude API（SDK 內建 429/5xx 退避）；Ragic 走 Outbox 重試不回退簽核；批次失敗不標 processed、下次重跑。
- **觀測**：pino 結構化日誌（含 `tenant_id/batch_run_id`）＋ `audit_log`；告警：批次失敗/Outbox 積壓/LLM 連續失敗。
- **成本**：Claude 分階 + prompt caching（POC 已驗證 cache 命中）；首期單租戶月量極小。

---

## 8. 測試策略
| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | 去識別遮罩、事件聚類、grounding 消歧、健康度狀態機邊界 | `*.test.ts` |
| Integration | 批次冪等（重跑不重複產 ticket）、Outbox 重試、Ragic 失敗不回退簽核、RLS 隔離 | `tests/` |
| E2E（R2 安全敏感 >80%）| 權限（A 查 B→403）、反幻覺（「門壞了」→low+攔截）、簽核 gate（未簽不進 Ragic）、不外流（上雲 payload 皆 token） | `tests/e2e/` |

---

## 9. 落地順序與里程碑
| 里程碑 | 內容 | 估算 | 狀態 |
|---|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED（用戶裁定 OQ-P1-1..8） | 1 日 | ✅ |
| **M1** 地基 | PG+RLS schema + JWT 中介層 + compose | 3 日 | ✅ SHIPPED |
| **M2** Ingest+批次 | 上傳→去識別→抽取→tickets | 4 日 | ⏳ **← 下一步** |
| **M3** 簽核+同步 | 狀態機 + Outbox + Ragic adapter | 3 日 | ⏳ |
| **M4** 戰情室 | API + tenant_admin/group_owner 真資料前端 | 4 日 | ⏳ |
| **M5** FMEA+驗收 | §12 逐路徑 + E2E；P0 全清 | 2 日 | ⏳ |

---

## 10. 開放問題（OQ-P1-N）— 待裁定
> **✅ 已裁定（2026-07-04）：OQ-P1-1..8 全數採用下方「建議」欄。** 每條一句問題 + 選項 + 建議 + 理由。

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-P1-1** | Phase 1 是單租戶還是多租戶地基？ | A. 單租戶垂直切片（最快）<br>B. 多租戶地基全上（RLS+aiproot+consultant）<br>C. 折衷：schema/RLS 一開始就多租戶就緒，但 UI 只做 tenant_admin+group_owner | **C** — RLS 晚補返工極大（隔離是核心），但 aiproot/consultant UI 首期用不到、延後。 |
| **OQ-P1-2** | 持久層 | A. 直接 PostgreSQL16+Drizzle+RLS<br>B. 先 SQLite 跑通再換 | **A** — RLS 是隔離機制、SQLite 無等價；系統文件已定案。dev 用 compose 起 PG。 |
| **OQ-P1-3** | 去識別 | A. Phase 1 就上地端 NER 模型<br>B. 先規則遮罩+對照表，NER 延後 | **B** — NER 選型/繁中準確率是獨立難題（§15），不該擋主迴圈；規則+對照表已足跑通。**⚠ 但上 prod 前信任邊界須完整（§12 P0）。** |
| **OQ-P1-4** | 訊息來源 | A. Phase 1 就接真 LINE webhook<br>B. 先匯出檔上傳跑通後端，webhook 後加 | **B** — webhook 需公開 HTTPS 端點+LINE 官方帳號+每租戶 channel，是獨立 infra；先上傳把 ingest→簽核→Ragic 跑通。（webhook 才有「媒體即收即存」時效問題） |
| **OQ-P1-5** | Ragic 匯流 | A. Phase 1 真寫 Ragic<br>B. 先 Outbox+模擬 sink，真接待欄位對應確認<br>C. 真/模擬可切換 adapter | **C** — 真接需台灣福祉 Ragic 表結構＋欄位對應（業務領域知識，需客戶/合夥人主導）；adapter 讓後端先跑通、對應確認後切真。 |
| **OQ-P1-6** | 簽核介面 | A. 只戰情室 web 後台<br>B. 也做 LINE Flex 簽核卡<br>C. 兩者 | **A（Phase 1）** — web 後台把狀態機做完整；LINE Flex 簽核（reply token 時效/計費）Phase 1 尾或 1.5 再加。 |
| **OQ-P1-7** | 多模態 | A. Phase 1 含 Whisper/OCR<br>B. 先純文字+媒體存檔（顯示素材卡不辨識） | **B** — 文字抽取已是最大價值；Whisper/OCR 需 GPU/模型 infra（§15），延後。媒體即收即存仍做（存 key）。 |
| **OQ-P1-8** | 六群組抽取 schema | A. 六群各自獨立 prompt/schema<br>B. 先共用一套（現況）+ department 標記，之後拆 | **A→漸進**：M2 先把 `departments.extraction_schema` 路由做出來，台灣福祉六群先用 2–3 套（報工/維修/研發），不足再拆。 |

---

## 11. SOP — 日常操作
> 落地後補（M4）。含：上傳匯出檔跑批次、簽核操作、Ragic 同步失敗排查、audit 查詢。

## 12. 失效場景反思（FMEA）— 收尾必填（R17）
> **M5 / 上 prod 前填**（pre-mortem）。逐路徑：ingest 上傳、去識別、批次抽取、簽核狀態轉換、Outbox 同步、RLS 邊界、部署順序。
>
> **現在已可預示的 P0（先記，M5 驗證）**：
> - 去識別漏遮 → 真名/車號上雲（跨界外洩）＝ **P0**，緩解：規則+對照表+上雲 payload 抽查測試（§13「不外流」）。
> - RLS 失效 → 跨租戶讀取 ＝ **P0**，緩解：API+RLS 雙驗 E2E。
> - 簽核 gate 繞過 → 未簽入 Ragic ＝ **P0**，緩解：Outbox 只由簽核交易入列 + 測試。
>
> **硬性 gate**：任一 P0 未 ✅ → 不得上 prod。

## 13. 變更紀錄
| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-04 | v0.1 | 初版 DRAFT — Phase 1 傘狀範圍切分 + OQ-P1-1..8 | Claude Code |
| 2026-07-04 | v0.2 | OQ-P1-1..8 全採建議裁定；DRAFT → APPROVED；進入 M1 | Claude Code |
| 2026-07-04 | v0.3 | **M1 SHIPPED**：地端 PG/RLS 隔離（FORCE RLS + 最小權限 app_rw）＋ NestJS auth 層（JWT/RBAC guard/租戶 interceptor＋audit）；RLS+auth 測試 15/15、security 模組 line cov ~99%；GUC 改名 app.actor_role（避 reserved word） | Claude Code |
