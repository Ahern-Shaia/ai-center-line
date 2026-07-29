# assign-notification-history · 推播記錄改存歷史（F3）

> 📋 **M0 · 待 review**（2026-07-29）· 這是**資料模型變更**，依 CLAUDE.md R6 需要人裁定後才實作。
>
> 觸發：用戶問「任務先派給 A、主管又改派給 B，A 回『好了』會不會關到 B 的票？」
> 追下去發現的第三層問題 —— 前兩層（F1 不猜、F2 改派要通知、F4 更正）已於 `b6efd99` 落地。
>
> 相關：[`task-assign-notify.md`](task-assign-notify.md)

---

## 0. 一句話結論

**`tickets.assign_notify_message_id` 是單一欄位，改派時會被覆蓋，
於是「我們曾經推給誰、推的是哪一則」這段歷史直接消失。
它不影響正確性（F1 已經堵住關錯票），影響的是我們**答得出什麼**。**

---

## 1. 現況與問題

### 1.1 現在長這樣

```
tickets
  ├─ assign_notified_at       timestamptz   ← 最後一次推播的時間
  ├─ assign_notified_user_id  uuid          ← 最後一次推給誰
  └─ assign_notify_message_id text          ← 最後一次那則的 LINE messageId
```

三欄都是「最後一次」。指派給 A 推一次、改派給 B 再推一次，**A 那次就沒了**。

### 1.2 消失的是什麼

| 場景 | 現在的行為 | 有歷史的話 |
|---|---|---|
| A 引用當初推給他的通知說「好了」 | 對不到 → 出選單問他「你回覆的那一件我對不到（可能已改由他人處理，或已經結案）」 | **「這件事已改由他人處理，你不用再跟。」** —— 講得出是哪一件、為什麼 |
| 排查「他到底有沒有收到通知」 | 只看得到最後一次 | 完整推播序列 |
| R5 稽核（所有寫入要有 actor / action / target / result） | 推播這個對外動作沒有留存 | 留存 |

> ⚠️ **這不是正確性問題**。F1 之後，對不到就不會亂關票 ——
> 差別只在我們回他的那句話是**含糊**還是**精準**。
> 所以這件事的價值是「訊息品質 ＋ 稽核」，不是「防堵」。不要把它當 P0 排。

### 1.3 為什麼不是「把欄位改成陣列」就好

想過三個更便宜的做法，都不成立：

| 做法 | 為什麼不行 |
|---|---|
| `assign_notify_message_id text[]` | 存得下 id，但存不下「這則是推給誰的」。而我們正是要用它回答「那件已改由**他人**處理」 |
| 存 `jsonb` 陣列 | 同上可行，但查詢要 `jsonb_array_elements` 展開才能用 messageId 反查 —— 這是**每則私訊都要跑一次**的熱路徑 |
| 不存，改用 `line_message` 反查 | bot 自己推出去的訊息**不會經過 webhook**，`line_message` 裡沒有它 |

---

## 2. 提案的 schema

```sql
-- 我們主動推給某人的「指派通知」· 一次一列，不覆蓋
CREATE TABLE assign_notification (
  message_id   text        PRIMARY KEY,          -- LINE 回傳的 sentMessages[].id
  tenant_id    uuid        NOT NULL REFERENCES tenants(tenant_id)  ON DELETE CASCADE,
  ticket_id    uuid        NOT NULL REFERENCES tickets(ticket_id)  ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users(user_id)      ON DELETE CASCADE,
  kind         text        NOT NULL DEFAULT 'assigned',
  sent_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT an_kind_check CHECK (kind IN ('assigned', 'taken_over'))
);

CREATE INDEX an_ticket_idx ON assign_notification (ticket_id, sent_at DESC);

ALTER TABLE assign_notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE assign_notification FORCE  ROW LEVEL SECURITY;
```

**`message_id` 當主鍵**：反查是熱路徑（每則私訊進來都要查一次），
而我們永遠是拿 messageId 去問「這是哪一張票的通知」。

### 2.1 RLS policy（⚠️ 本專案已踩 12 次 RLS 靜默回 0）

```sql
CREATE POLICY an_tenant ON assign_notification USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
);
```

三個刻意的選擇：

- **`nullif(..., '')`**：`current_setting(..., true)` 沒設時回**空字串**不是 NULL，
  直接 `::uuid` 會拋 `invalid input syntax for type uuid: ""`。
  `tickets` 的 policy 就是這樣寫的，照抄。
- **不放 `system` 逃生門**：跟 `tickets` 一致。webhook 全段跑在 `withSystemTx` 裡，
  留了 system 門會讓人以為在那裡查得到，但相鄰的 `tickets` 查詢照樣回 0 筆 ——
  變成一半資料查得到一半查不到，比整個查不到更難排查。
  呼叫端一律自己開 `withTenant`（`PrivateCompletionService` 已經是這樣）。
- **不放 `OR aiproot_admin`**：`tickets` 是純租戶範圍（AND-only），
  這張表永遠跟著 tickets 一起被查，兩者範圍不一致只會製造「票查得到、通知記錄查不到」的怪象。
  aiproot 要查就跟查 tickets 一樣先設 `app.current_tenant`（`scripts/prod-query.sh` 已經這樣做）。

### 2.2 `tickets` 那三欄怎麼辦

| 欄位 | 處置 | 理由 |
|---|---|---|
| `assign_notified_user_id` | **留** | A-4「同一張票對同一人只推一次」還在用它做判斷，改查新表等於把熱路徑變複雜 |
| `assign_notified_at` | **留** | 同上，且前端「已通知」的顯示吃它 |
| `assign_notify_message_id` | **廢，但不立刻刪** | 讀改走新表；欄位留兩個版本再刪（見 §4） |

---

## 3. 行為會怎麼變

只有一處：`PrivateCompletionService.handleText` 引用對不到時。

```
現在：  「你回覆的那一件我對不到（可能已改由他人處理，或已經結案）。
         你手上還有 2 件在進行：① … ② …」

之後：  查 assign_notification → 找到那張票 → 看它現在的狀態
        ├─ 已改派他人  → 「這件事已改由他人處理，你不用再跟。」
        ├─ 已經結案    → 「這件事已經是完成狀態了。」
        └─ 還是他的但沒對到（理論上不該發生）→ 維持現在的選單
```

`handlePostback` 的分支邏輯已經是這三種，措辭直接沿用，不必新寫。

---

## 4. 遷移計畫（R1）

| 步 | 動作 | 可逆 |
|---|---|---|
| 1 | 建表 + RLS + index | ✅ drop table |
| 2 | 回填：`INSERT ... SELECT` 把現存 `assign_notify_message_id IS NOT NULL` 的搬進去 | ✅ |
| 3 | 寫入端雙寫（新表 ＋ 舊欄位） | ✅ |
| 4 | 讀取端改查新表 | ✅ |
| 5 | 觀察兩週後停止雙寫、`DROP COLUMN assign_notify_message_id` | ⚠️ 不可逆，另開 |

> 回填量：prod 目前 `assign_notify_message_id IS NOT NULL` 的筆數是 **0**
> （功能今天才上線，還沒有人真的被指派過）。**所以現在做這件事幾乎沒有遷移成本 ——
> 越晚做越貴。** 這是唯一支持「現在就做」的論點。

---

## 5. 失效場景反思（FMEA · R17）

| # | 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|---|
| **H-1** | RLS | 忘了 `nullif(..., '')`，或多開了 `system` 逃生門 | 前者在沒設 tenant 時直接拋型別錯；後者製造「票查不到、通知記錄查得到」的半套視野 | **P0** | §2.1 明寫 policy 全文與三個理由 · migration review 時逐字比對 |
| **H-2** | 熱路徑 | 每則私訊都多一次查詢 | 延遲增加 | P2 | `message_id` 是主鍵，單筆點查；只在「有引用且快路徑沒中」時才跑 |
| **H-3** | 資料量 | 每次指派都寫一列，長期堆積 | 表變大 | P2 | 一張票最多幾列（指派次數），量級跟 `tickets` 同級 · 不需保留策略 |
| **H-4** | 一致性 | 雙寫期間新表寫成功、舊欄位失敗（或反之） | 兩邊不一致 | P1 | 同一個 tx 內寫，一起成功或一起回滾 |
| **H-5** | 依賴 | LINE 不回 `sentMessages[].id` → `message_id` 為 null 就寫不進去（主鍵） | 整張表是空的，等於沒做 | **P1** | ⚠️ **這是先決條件** · 見 §6 |

---

## 6. ⭐ 開工前的先決條件

**這張表的主鍵是 LINE 回傳的 messageId。如果 LINE 根本不回，這整件事沒有意義。**

而我們**還沒有實測過**（FMEA A-15）：兩支 client 原本都直接丟棄 push 回應。
`b6efd99` 之後 `line-api.client.ts` 拿不到會 warn 一聲，
prod 也已經有欄位可以觀察 —— **第一次真實指派之後，
查 `tickets.assign_notify_message_id` 是不是還是 0 就知道。**

> **建議：先等一次真實指派**（幾天內主管一定會派），確認 messageId 拿得到，再開 M1。
> 不然可能建了一張永遠空的表。

---

## 7. 開放問題（OQ-ANH-N）

| # | 問題 | 建議 |
|---|---|---|
| **OQ-ANH-1** | 現在做，還是等 messageId 實測確認？ | **等實測**（§6）· 但如果要做就趁早，回填量現在是 0 |
| **OQ-ANH-2** | 「已改由他人處理」的私訊（`kind='taken_over'`）也要記嗎？ | **要** · 同一張表同一個 kind 欄位，成本是 0；不記的話「他到底有沒有被告知」一樣查不到 |
| **OQ-ANH-3** | 要不要順便記推播失敗？ | **不要** · 失敗沒有 messageId，塞不進以它為主鍵的表 · 失敗已經走 `notification_log`（既有） |
| **OQ-ANH-4** | 舊欄位什麼時候刪？ | 雙寫觀察**兩週**後另開一次 migration · 不併在同一批 |

---

## 8. 里程碑

| # | 內容 | 依賴 |
|---|---|---|
| **M0** 📋 | 本 doc · 待裁定 OQ-ANH-1..4 | — |
| **M1** | migration：建表 ＋ RLS ＋ 回填 | OQ 裁定 ＋ §6 先決條件 |
| **M2** | 寫入端雙寫（`onAssigned` / `notifyTakenOver`） | M1 |
| **M3** | 讀取端改查新表 · 引用對不到時回精準訊息 | M2 |
| **M4** | 觀察兩週 → 停雙寫 → `DROP COLUMN` | M3 |

---

## 9. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-29 | v0.1 | M0 首版 · 起於「A 被改派後拿舊通知回報」情境的第三層 · ⭐ 明確界定這是**訊息品質＋稽核**而非防堵（防堵由 F1 完成，已落地）· ⭐ 回填量現在是 0，越晚做越貴 · ⚠️ 但主鍵依賴 LINE 回傳 messageId，而那件事還沒實測過 —— 建議先等一次真實指派再開工，否則可能建一張永遠空的表 | ahern + Claude Code |
