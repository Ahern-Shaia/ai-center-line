# MODULES — 模組狀態索引

> 每個非 trivial 模組走 M0（design doc + OQ 裁定）→ M1–M4 落地 → M5 FMEA（R17）→ 標 ✅。
> 設計文件在 `docs/modules/<module>.md`。

| 模組 | 設計文件 | 狀態 | 備註 |
|---|---|---|---|
| Phase 1 · 台灣福祉一條龍 Live Loop | [`modules/phase1-live-loop.md`](modules/phase1-live-loop.md) | 🔨 **M1 ✅，進 M2** | M1 地基＋auth SHIPPED（RLS+auth 測試 15/15）；下一步 M2 Ingest/批次 |
| 智慧檢索 RAG 對話 | [`modules/rag-conversations.md`](modules/rag-conversations.md) | 🚧 **M0 DRAFT v0.2** | 對應 §1-C C3 · P1；待用戶裁定 OQ-RAG-1..8；前端已跑通 mock（兩窗格 NotebookLM 風 + 多模態 source viewer · image/spreadsheet 已可 render） |
| 戰情室設計研究（v9/v10 blueprint） | [`modules/design-research-warroom.md`](modules/design-research-warroom.md) | ✅ 參考 | 前端視覺研究，非落地模組 |
| Ragic → LINE 通知（notify） | [`modules/notify.md`](modules/notify.md) | ✅ **SHIPPED v1.0**（2026-07-08）| 首發 sheet：TB-P71 中部維修保養單（aitode `/service-tickets/10`）；Post workflow + Action Button 皆通；企業風 16 欄訊息 + Ragic 記錄連結；`/notify/ragic/maintenance-report` prod endpoint (Render `ai-center-line.onrender.com`)；33 個 unit tests、2 個 P0 (E5/D2) 已緩解 |

## 狀態圖例
- 🚧 **M0 DRAFT**：design doc 草擬中／待用戶裁定 OQ
- 🔨 M1–M4：實作中（標到哪個里程碑）
- 🧪 M5：FMEA + 驗收（P0 未清不得上 prod）
- ✅ SHIPPED：全里程碑完成、P0 全清
