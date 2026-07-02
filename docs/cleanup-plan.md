# cleanup-plan.md — ai-center-line 功能收斂計畫

> 📋 **狀態：DRAFT — 待用戶勾選砍除批次（YYYY-MM-DD）**
>
> [新專案 / 接手既有專案 / Phase X 結束] 後輪到清理不必要的功能 — 降低長期維護負擔。本檔列**候選清單** + **批次建議** + **風險評估**。砍除動作分批次提交，每批一個 commit。
>
> 作者：Claude Code（草擬，YYYY-MM-DD）

---

## 1. 目標

1. **降低心智負擔** — 不再需要在 review 時判斷「這條 code 是給 X 還是給 Y」
2. **降低 attack surface** — 死路徑被誤觸發的風險
3. **降低 build / test 時間** — 移除整個 module 後跨層 imports 收斂
4. **proto / schema 演進空間** — 把死欄位拿掉，未來改 schema 不再被 dormant code 拖住

---

## 2. 不做的事

- ❌ **不重寫核心架構** — 牽涉太廣
- ❌ **不一次砍完** — 每批小到能單 commit 收尾 + 重跑 smoke
- ❌ **不刪 proto enum value**（改 enum 值會擴散到所有 generated bindings，比留 dormant 更貴 — 標 `reserved` 取代）

---

## 3. 候選清單（按砍除難度排序）

### 3.1 Tier A — 低風險小範圍（推薦先做）

| # | 候選 | 規模 | Live caller | UI 入口 | 副作用 |
|:-:|---|---|---|---|---|
| **A1** | [候選名] | ~XXX LOC | N 處 | 無 / [URL] | [簡短描述] |
| **A2** | ... | ... | ... | ... | ... |
| **A3** | ... | ... | ... | ... | ... |

**Tier A 合計**：~XXXX LOC，X 天，零架構衝擊。

### 3.2 Tier B — 中度範圍（需 audit + 決策）

| # | 候選 | 規模 | 風險 | 需先決策 |
|:-:|---|---|:-:|---|
| **B1** | [候選名] | ... | 🟡 中 | [決策問題] |
| **B2** | ... | ... | 🟡 中 | ... |

### 3.3 Tier C — 不碰

| # | 候選 | 理由 |
|:-:|---|---|
| **C1** | [核心架構] | 牽涉太廣，重做需數個月 |
| **C2** | [關鍵基礎] | 雖然不完美但有 caller |

---

## 4. 批次建議

### 批次 1（Tier A 整批）

把 **A1–AN** 合成一個批次，預估 N 個 commit：

```
chore(cleanup): A1 [一句話] (~XXX LOC)
chore(cleanup): A2 ...
chore(cleanup): A3 ...
```

每個 commit 後跑 build + frontend type-check + 該批的 unit test。

### 批次 2（Tier B 視決策）

[依 OQ-CL 裁定]

---

## 5. 每批驗證 SOP

1. `[build command]` — 編譯通過
2. `[test command]` — 既有測試全綠
3. `[type-check command]` — 0 error
4. **手動冒煙**：跑一次核心流程，確認砍除沒有打到關鍵 path

---

## 6. 開放問題（OQ-CL-N）— 待裁定

| # | 議題 | 選項 |
|:-:|---|---|
| **OQ-CL-1** | Tier A 整批做嗎？ | A. 全做 / B. 挑幾個 / C. 先停 |
| **OQ-CL-2** | [Tier B 決策題] | ... |

---

## 7. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| YYYY-MM-DD | v0.1 | 初版 DRAFT — Tier A / B / C 候選 | Claude Code |
