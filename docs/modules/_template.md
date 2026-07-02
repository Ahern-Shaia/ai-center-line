# [MODULE_NAME].md — [Priority-N] [Module Title] 設計文件

> 🚧 **狀態：DRAFT — 待用戶裁定 OQ-[ABBR]-1..N（YYYY-MM-DD）**
>
> [一段話描述模組目的 + 為何要做]
>
> 作者：Claude Code（草擬）
> 版本：v0.1（YYYY-MM-DD）

---

## 1. 目標與範圍

### 1.1 目標

[列 2–5 點具體目標。每點是「使用者能做到 / 系統能做到」的可驗證敘述]

1. ...
2. ...
3. ...

### 1.2 對應主管 / Stakeholder 訴求

> 如果有 stakeholder requirement table，把這個 module 對應到哪幾條訴求列出來。

| 子題 | 主要訴求 | 次要訴求 | 對應點 |
|---|---|---|---|
| A1 ... | ① | ④ | [一句話描述為什麼這個 sub-task ladders 到這條訴求] |

### 1.3 不做的事

> 明確列出 scope 邊界 — 防止 scope creep + 給 reviewer 明確「這個 PR 不會做 X」的信號

- ❌ **不重寫核心架構** — [具體]
- ❌ **不新建 DB 表** — [理由]
- ❌ **不擴 proto 既有 message** — [理由]

---

## 2. 上游 / 既有現況走查

> 動工前先走查既有 code，看哪些 sub-task 上游已經做了、哪些是真的缺口。

| 子題 | 上游現況 | Gap |
|---|---|---|
| ... | ✅ 已有 | 無 |
| ... | 部分有 | [描述缺口] |
| ... | 沒有 | 全新做 |

---

## 3. 剩餘 scope 切分

| 子題 | 內容 | 估算 |
|---|---|---|
| **A1 ...** | [一兩句具體做什麼] | 0.04 mo |
| **A2 ...** | ... | 0.05 mo |
| **A3 ...** | ... | 0.02 mo |

**合計**：M1+M2+M3+M4 = **0.XX mo**

---

## 4. A1 ...

[每個 sub-task 一節。描述具體實作 — 程式碼結構 / 資料模型 / API / UI]

### 4.1 資料模型

[proto / SQL / TypeScript interface]

### 4.2 邏輯

[流程描述 + 關鍵程式碼片段]

### 4.3 UI

[wireframe 描述 + 對應 page / component]

---

## 5. A2 ...

[同上格式]

---

## 6. A3 ...

[同上格式]

---

## 7. 資料模型變動

### 7.1 Proto

- [list proto changes]

### 7.2 SQL Migration

- [list DDL or 「免 migration」]

### 7.3 RLS / Permission

- [影響說明]

---

## 7-bis. 企業級 cross-cutting 檢核（Mode B 必填）

> 互動模式（Mode A）可略過本節。企業級自主模式（`--dangerously-skip-permissions`）必須填齊。
> 詳見 `memory/rule_cross_cutting_checks.md`。

### 7-bis.1 安全模型

| 攻擊面 | 緩解措施 | 對應實作 |
|---|---|---|
| External user → 越權呼叫 | authn middleware + IAM check | [指向具體 middleware / ACL rule] |
| Internal user → privilege escalation | role-based gate + audit log | [...] |
| Lateral movement | network policy + secret scoping | [...] |
| Supply chain | dependency pinning + checksum verify | [...] |

Input validation：[列每個 user-supplied 欄位的 sanitization / max length / format check]

### 7-bis.2 容量規劃

- **預估 QPS**：[normal / peak]
- **預估資料量**：[per row size × growth rate → 月增長]
- **Blast radius**：[單一 user 操作影響行數 / 受影響工單數]
- **Critical query plan**：[`EXPLAIN ANALYZE` 主要 query 的 plan + index 命中情況]
- **Lock scope**：[寫入路徑的 lock 範圍 — table / row / advisory]

### 7-bis.3 失效模式

每個 external call / async path：

| 路徑 | Timeout | Retry policy | Circuit breaker | Fallback |
|---|---|---|---|---|
| [LLM provider] | 30s | exp backoff × 2 | open at 50% fail rate | 標 LLM_FAILED status |
| [DB write] | tx timeout 5s | no retry (idempotent only) | n/a | propagate error |

### 7-bis.4 觀測性

新增 / 改動的指標：

| 類型 | 名稱 | 用途 |
|---|---|---|
| metric (counter) | `<module>_request_total` | 流量 |
| metric (histogram) | `<module>_request_duration_seconds` | latency p50/p95/p99 |
| metric (counter) | `<module>_errors_total{reason}` | 錯誤分類計數 |
| trace | `<module>.<operation>` | 跨 service 追蹤 |
| structured log | `slog.Error(..., slog.String("user", ...))` | error path 含 actor / target |
| alert | `<module>_error_rate > 5% for 5min` | severity=page；runbook: [link] |

### 7-bis.5 資料生命週期

- **Retention**：[保存期限 — 對齊 SOC 2 / ISO 27001 / GDPR]
- **PII 標記**：[列哪些欄位是 PII / 加密欄位]
- **Right-to-erasure**：[GDPR 刪除請求怎麼處理本模組的資料]
- **Encryption**：[at rest / in transit / column-level]
- **Cross-region replica**：[是否複製 / 限制]

### 7-bis.6 向後兼容 + Rollout

- **Proto 變更**：[新欄位 / reserved field number / deprecated]
- **API versioning**：[新 endpoint / breaking change handling]
- **Migration rollback**：[`up.sql` / `down.sql` / 或 PR description 描述 reverse]
- **Feature flag**：[名稱 + gradual ramp 比例 + kill switch]

### 7-bis.7 成本模型

以 1000 daily-active users 假設：

| 資源 | 增量 | 月成本量級 |
|---|---|---|
| DB query | +X / user-action | $Y / month |
| External API | +X / user-action | $Y / month |
| Storage | +X MB / day | $Y / month |
| Compute | +X CPU-second / request | $Y / month |

**Total incremental cost** of this module: $XX / month at 1k DAU baseline.

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | 純函數 / 邏輯 | `*_test.go` / `*.test.ts` |
| Integration | API + DB | `tests/` |
| Smoke | 手動 walk-through | M4 收尾 |

至少 X 個 unit tests。

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 預估 | 狀態 |
|---|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED（用戶定 OQ-N）| 0.02 mo | ⏳ |
| **M1** ... | ... + N tests | 0.04 mo | ⏳ |
| **M2** ... | ... | 0.05 mo | ⏳ |
| **M3** ... | ... | 0.02 mo | ⏳ |
| **M4** docs + smoke | doc → v1.0 + MODULES.md → ✅ | 0.02 mo | ⏳ |
| **M5** FMEA 收尾（R17）| 填 §12 失效場景反思（逐路徑 → 嚴重度 → 緩解）；P0 未緩解不得上 prod | 0.02 mo | ⏳ |

---

## 10. 開放問題（OQ-[ABBR]-N）— 待裁定

> [ABBR] = 模組縮寫。例如 `OQ-APP-1` 對應 approval module 第 1 個開放問題。
> 每條 OQ 一句問題 + 2-4 個選項 + Claude Code 的建議 + 為什麼。
> 用戶選好後，本節改成「已裁定」+ 寫入裁定理由。

| # | 訴求 | 議題 | 選項 | 建議 |
|---|:-:|---|---|---|
| **OQ-[ABBR]-1** | ② | [一句問題] | A. ... <br> B. ... | **A** — [理由] |
| **OQ-[ABBR]-2** | ① | ... | ... | ... |

---

## 11. SOP — 日常操作

> 模組落地後給 admin / DBA / 二線值班的操作指引

### 11.1 [使用情境 1]

1. 進 [URL]
2. 點 [按鈕]
3. 預期 [結果]

### 11.2 失敗模式排查

| 症狀 | 含意 | 處置 |
|---|---|---|
| ... | ... | ... |

### 11.3 審計查詢

```sql
-- 過去 7 天所有 X 事件
SELECT ...
```

---

## 12. 失效場景反思（FMEA）— 收尾必填（R17）

> **何時填**：M4 收尾 / 標「完成」/ 上 prod **之前**（pre-mortem 心態：假設它會壞，反推哪裡壞）。
> **怎麼填**：**逐路徑**列「失效模式 → 影響 → 嚴重度 → 緩解狀態」。不是只列你修好的，**已知殘留也要列**。
> **嚴重度**：`P0` = 讓使用者**無法完成核心流程 / 資料毀損 / 跨租戶外洩**；`P1` = 資料髒 / 體驗差 / 可繞過；`P2` = 邊角。
> **狀態**：✅ 已處理｜⚠️ 已知殘留（寫清楚為何可忍 + 治本方向）｜🔒 被外部 gate 擋（法律 / 第三方）。
> **硬性 gate（R17）**：**任一 P0 未到 ✅ → 不得上 prod**。

逐路徑（每個入口 / 外呼 / 狀態轉換 / 並發點各一小節）：

### 12.1 [路徑名，例：API endpoint X]

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| X1 | [輸入非法 / 缺欄 / 並發 / 第三方 timeout / 部署順序…] | [系統回什麼] | ✅/⚠️/🔒 | P0/P1/P2 |

### 12.2 部署順序（migration / 後端 / 前端）

| # | 場景 | 風險 | 緩解 |
|---|---|---|---|
| D1 | 後端 code 先於 migration | 缺欄 → 需登入 API 全 500 | migration 必先（R10 人工跑 + 自查欄位） |

### 12.3 不在本 module scope 修的 pre-existing 問題

- [列出發現但刻意不修的既存問題 + 為何 out of scope + 該開哪張 ticket]

> **檢查點**：上面所有 P0 是否都 ✅？否 → 回去修，不得標 SHIPPED。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| YYYY-MM-DD | v0.1 | 初版 DRAFT — sub-task + OQ-[ABBR]-N | Claude Code |
| YYYY-MM-DD | v0.2 | OQ-[ABBR]-1..N 全部裁定；狀態 DRAFT → APPROVED；進入 M1 | Claude Code |
| YYYY-MM-DD | v1.0 | M1–M5 全部 SHIPPED（含 §12 FMEA、P0 全清）；補 SOP；狀態 APPROVED → SHIPPED | Claude Code |
