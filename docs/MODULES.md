# MODULES — 模組狀態索引

> 每個非 trivial 模組走 M0（design doc + OQ 裁定）→ M1–M4 落地 → M5 FMEA（R17）→ 標 ✅。
> 設計文件在 `docs/modules/<module>.md`。

| 模組 | 設計文件 | 狀態 | 備註 |
|---|---|---|---|
| Phase 1 · 台灣福祉一條龍 Live Loop | [`modules/phase1-live-loop.md`](modules/phase1-live-loop.md) | 🔨 **M1 ✅，進 M2** | M1 地基＋auth SHIPPED（RLS+auth 測試 15/15）；下一步 M2 Ingest/批次 |
| 智慧檢索 RAG 對話 | [`modules/rag-conversations.md`](modules/rag-conversations.md) | 🚧 **M0 DRAFT v0.2** | 對應 §1-C C3 · P1；待用戶裁定 OQ-RAG-1..8；前端已跑通 mock（兩窗格 NotebookLM 風 + 多模態 source viewer · image/spreadsheet 已可 render） |
| 戰情室設計研究（v9/v10 blueprint） | [`modules/design-research-warroom.md`](modules/design-research-warroom.md) | ✅ 參考 | 前端視覺研究，非落地模組 |
| Ragic → LINE 通知（notify） | [`modules/notify.md`](modules/notify.md) | ✅ **SHIPPED v1.0**（2026-07-08）| 首發 sheet：TB-P71 中部維修保養單（aitode `/service-tickets/10`）；Post workflow + Action Button 皆通；企業風 16 欄訊息 + Ragic 記錄連結；`/notify/ragic/maintenance-report` prod endpoint (Render `ai-center-line.onrender.com`)；33 個 unit tests、2 個 P0 (E5/D2) 已緩解 |
| notify 多租戶化 + 鮮勇兩表 | [`modules/notify-multi-tenant.md`](modules/notify-multi-tenant.md) | ✅ **SHIPPED v1.0**（2026-07-17）| M1–M5 全部落地、上 prod、smoke 全過（台灣福祉 back-compat/鮮勇報價單 `/erp/1`/鮮勇原料驗貨單 `/erp/64` 皆通）；tenant registry（secret 兼識別）+ WebhookSecretGuard tenant-aware + LineClient stateless + notification_log tenant_id text NOT NULL + migration 0004；72 unit tests 全綠；兩踩坑：**NestJS DI 有 default 的 param 仍會被 resolve → 用 @Optional()**（hotfix 04703c8）、**Ragic Post-workflow 儲存後不立即生效、需登出重進才 active** |
| LINE 對話分析 · pilot 版（web-based · 兩階段）| [`modules/conversation-analysis-pilot.md`](modules/conversation-analysis-pilot.md) | 🧪 **APPROVED v0.4**（2026-07-20）· M1 backend 本地 SHIPPED · 戰略對齊 EEA 平台待重寫 | v0.3 scope（web-based · leverage 現有後台 · 兩階段 pilot · M1-M8 · OQ-CVA-1..15）保留；**v0.4 §17 加競品分析 + 產品線架構定位**（EEA 超級平台 host + weyver 中和 Ragic 威脅 + ai-center-line = 資料/AI/通訊層）· pilot 重新定位為「EEA §5.12 大案技術驗證前導」不是獨立 SaaS · Stage 2 併入 EEA · **⚠️ M1-M5 / OQ 待下輪 rev 對齊 EEA §5.1 中介資料層**；相關：[`對話分析功能-可行性反思-2026-07-20.md`](對話分析功能-可行性反思-2026-07-20.md)、memory [產品線架構](../../../.claude/projects/-Users-ahern-Documents----ai-center-line/memory/project_product_line_architecture.md) |

## 狀態圖例
- 🚧 **M0 DRAFT**：design doc 草擬中／待用戶裁定 OQ
- 🔨 M1–M4：實作中（標到哪個里程碑）
- 🧪 M5：FMEA + 驗收（P0 未清不得上 prod）
- ✅ SHIPPED：全里程碑完成、P0 全清
