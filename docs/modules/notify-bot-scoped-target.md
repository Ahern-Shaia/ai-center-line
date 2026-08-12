# 設計文件 · 通知規則綁定發送 bot（M0）

> 狀態：📋 **M0 DRAFT v0.1**（2026-08-12）· **待裁定 OQ-NBT-1..8**
> 對象：`notification_rule`、`notification.pipeline.ts`、`rule.repository.ts`、通知設定精靈（`web/src/notify-config/Wizard.tsx`）
> 相關：[`notify.md`](notify.md)、[`notify-multi-tenant.md`](notify-multi-tenant.md)、[`notify-selfserve-platform.md`](notify-selfserve-platform.md)
>
> **一句話**：通知規則現在**不知道自己要用哪支 LINE bot 發送**，於是靠兩層猜測（環境變數 → 該租戶最新建立的 bot）。
> 使用者手填群組 ID，而群組 ID 是**依 bot 發放**的 —— 兩者對不上就 400，且錯誤訊息看不出原因。
> 正解是把「選 bot → 選該 bot 所在的群」變成必經流程，讓錯誤在**結構上不可能發生**。

---

## 1. 觸發事件（2026-08-12 · 鮮湧報價單推送失敗）

使用者看到：

```
400 HTTP 400: Failed to send messages
```

排查後（prod 實查）：

| 檢查 | 結果 |
|---|---|
| 訊息長度 | 454 字元（LINE 上限 5000）→ ❌ 不是這個 |
| 目標群 `C20f79b7…` 存在嗎 | ✅ 存在 = 鮮湧AI客服測試群 · `active` |
| `鮮湧AI客服` 在群裡嗎 | ✅ 在（使用者截圖確認 7 位成員含它） |
| 欄位對應 | ✅ 對上 17/17 |
| **實際用哪支 bot 發送** | ❌ **不是鮮湧AI客服** |

---

## 2. 根因（兩層猜測）

### 2.1 第一層：規則沒有租戶 → 退回全域 env token

```ts
// notification.pipeline.ts
const token = rule.tenantId
  ? await withSystemTx((tx) => this.rules.getLineTokenForTenant(tx, rule.tenantId))
  : null;
const res = await this.line.pushText(token ?? process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "", to, text);
```

**prod 實查：五條規則的 `tenant_id` 全是 NULL。** 所以全部走 `LINE_CHANNEL_ACCESS_TOKEN` —— 單一一支 bot 的 token。

| 規則 | 目標群 | 群屬於哪支 bot | 結果 |
|---|---|---|---|
| **報價單（下游-1）** | `C20f79b7…` | **鮮湧AI客服** | ❌ 400 |
| TB-P01 分析表 | `C452bb99…` | （我方無紀錄） | ✅ |
| TB-P02 顧客產品需求通知單 | `C452bb99…` | （我方無紀錄） | ✅ |
| 收貨單（上游-4） | `C452bb99…` | （我方無紀錄） | ✅ |
| 訂購憑單(v) | `C452bb99…` | （我方無紀錄） | ✅ |

→ 四條正常是因為目標群剛好是**全域 token 那支 bot** 所在的群；報價單指到鮮湧的群就炸。

### 2.2 第二層：就算補上租戶，選 bot 仍是猜的

```sql
-- getLineTokenForTenant
WHERE tenant_id = ? AND status = 'active'
ORDER BY created_at DESC LIMIT 1
```

**「該租戶最新建立的那支」。** 鮮湧目前只有一支 active 所以剛好對，多一支就會靜默送錯。

> ⚠️ 這與 2026-08-04 修掉的「LIFF 沒帶 botId 就取最新綁定」是**同一個形狀**
> （見 [[pitfall_line_user_id_multi_tenant]]）。當時的教訓是：**多筆候選時不可以猜**。
> 這裡連「候選是誰」都沒被記錄下來。

### 2.3 為什麼使用者查不出原因

群組 ID 是**依 bot（provider）發放**的（見 [[pitfall_line_ids_are_provider_scoped]]）。
所以「群 ID 正確」和「這支 bot 送得到那個群」是兩件事，畫面上分不出來。
加上 LINE 的 400 外層訊息 `Failed to send messages` 等於沒說（`details[]` 已於 commit `997780f` 補上）。

---

## 3. 使用者提出的正解（2026-08-12）

> 「少一個前置條件：LINE Bot 要在群組裡。那最後一步就不用手填寫了，
> 因為選完要發送的 LINE Bot，自然會出現對應的機器人（所在的群）。」

**把「選 bot → 選該 bot 所在的群」變成必經流程。** 資料已經有了：`line_group` 有 `bot_id`。

這一步同時解掉四件事：

| 解掉的問題 | 方式 |
|---|---|
| 手填群組 ID | 下拉選單 |
| 挑到別支 bot 的群 | **選項本身已過濾** —— 結構上不可能 |
| pipeline 猜 token | 規則記下 bot，直接取它的 token |
| 全域 env token 退路 | 可以拿掉 |

**與「小白舒適」的關係**：現在要人自己知道①要送到哪個群 ②群 ID 去哪裡找 ③那支 bot 在不在裡面。
三個判斷全部消失 → 對齊 [[feedback_novice_comfort_is_the_moat]] 的「使用者要判斷幾次＝0」。

---

## 4. 資料模型變動（R1）

```sql
ALTER TABLE notification_rule
  ADD COLUMN IF NOT EXISTS bot_id uuid REFERENCES line_bot(bot_id);
```

- **nullable**：既有 5 條規則沒有 bot，不能硬性 NOT NULL（見 §6 資料修補）
- pipeline 取 token 的順序改為：`rule.bot_id` → （過渡）租戶最新 active bot → ❌ 不再退回 env

### 既有欄位的處理

`tenant_id` 保持不變，但**建立規則時必須寫入** —— 由所選 bot 的 `tenant_id` 推導，
使用者不必再選一次（bot 已經隱含租戶）。

---

## 5. ⚠️ 順帶發現的租戶隔離問題

`notification_rule` 的 RLS policy 是 **`app_is_platform_ops()`**（`aiproot_admin` / `consultant` / `assistant` / `system`），
**不是 tenant-scoped**。也就是說：

- 通知規則目前是**平台端功能**，客戶自己看不到也改不了
- 而 `listEnabledForEvent` 明確允許 `tenant_id IS NULL`：
  ```sql
  AND (tenant_id IS NULL OR tenant_id = ${tenantId}::uuid)
  ```
  → **沒有租戶的規則會對「所有租戶的事件」生效**

現在五條規則全是 NULL 租戶。目前只影響 `internal_event` 類型（這五條是 Ragic webhook 型，不走這條路），
但一旦有人建了 NULL 租戶的內部事件規則，**它會對每一家客戶都發**。

→ 這是 OQ-NBT-6 要裁定的：NULL 租戶到底該不該繼續支援。

---

## 6. 既有資料修補

五條規則需補 `bot_id` 與 `tenant_id`：

| 規則 | 目標群 | 建議 |
|---|---|---|
| 報價單（下游-1） | `C20f79b7…`（鮮湧AI客服測試群） | bot = 鮮湧AI客服 · tenant = 鮮湧 |
| 其餘四條 | `C452bb99…`（我方無紀錄） | ⚠️ **需先查出那是哪支 bot 的群** —— 見 OQ-NBT-2 |

> ⚠️ `C452bb99…` 不在 `line_group` 裡，代表我方從未收過該群的 webhook 事件
> （可能是 bot 在 webhook 設定完成前就已加入）。**修補前必須先確認它屬於誰**，
> 不可以憑「現在能送成功」就假設是全域 token 那支 —— 那只是目前碰巧成立。

---

## 7. 開放問題（OQ-NBT-N）— 待裁定

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-NBT-1** | 精靈流程改成「先選 bot 再選群」？ | (a) 是 (b) 保留手填為進階選項 | **(a)** —— 保留手填等於保留那條會出錯的路 |
| **OQ-NBT-2** | `C452bb99…` 是哪支 bot 的群？ | —— | ⛔ **前置**。修補資料前必須查出來（可用各 bot token 呼叫 LINE 的 group summary 逐一試） |
| **OQ-NBT-3** | 群組清單只列 `status='active'` 的嗎？ | (a) 只列 active (b) 全列但標記 | **(a)** —— 已離開的群送了也是 400 |
| **OQ-NBT-4** | `line_group` 沒紀錄的群怎麼辦？ | (a) 選不到就是不能選 (b) 保留手填後門 | **(a)** + 提示「群組沒出現？把機器人拉進群後在群裡發一則訊息」 |
| **OQ-NBT-5** | pipeline 還要不要保留 env token 退路？ | (a) 拿掉 (b) 保留 | **(a)** —— 它正是這次事故的成因；拿掉後未設 bot 的規則會明確報錯而非送錯家 |
| **OQ-NBT-6** | 還要支援 `tenant_id IS NULL` 的規則嗎？ | (a) 不支援，一律要有租戶 (b) 支援但需明示 | **(a)** —— 「對所有租戶生效」應該是明確的功能，不是欄位留空的副作用 |
| **OQ-NBT-7** | 既有五條規則怎麼處理？ | (a) 補資料 (b) 停用重建 | **(a) 補**，但依 OQ-2 的結果；報價單那條可立即補 |
| **OQ-NBT-8** | 要不要在儲存規則時**實際試送一則**？ | (a) 要 (b) 不要 | **(a)** —— 設定當下就知道通不通，勝過等真實事件才發現。訊息內容標明是測試 |

---

## 8. 落地順序

| 里程碑 | 內容 |
|---|---|
| **M0** | 本文 · 待裁定 OQ-NBT-1..8（OQ-2 為前置） |
| **M1** | migration 加 `bot_id` + pipeline 改用它取 token（保留過渡 fallback）|
| **M2** | 精靈改「選 bot → 選群」下拉；`line_group` 撈該 bot 的 active 群 |
| **M3** | 補既有五條規則的 `bot_id` / `tenant_id`（依 OQ-2、OQ-7）|
| **M4** | 拿掉 env token 退路（OQ-5）+ 儲存時試送（OQ-8）|

> M4 必須在 M3 之後 —— 資料沒補完就拿掉退路，現在會動的四條規則會全部停擺。

---

## 9. 失效場景反思（FMEA · R17）

| 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|
| 發送 | 規則沒 `bot_id` 又拿掉 env 退路 | 通知全停 | **P0** | ✅ M4 排在 M3 之後；過渡期保留 fallback |
| 發送 | 目標群的 bot 已被移出群 | 400 | P1 | ✅ commit `997780f` 已讓 LINE 的 `details[]` 顯示；OQ-8 的試送可提早發現 |
| 設定 | 群組清單很長（大租戶） | 難選 | P2 | ⚠️ 需搜尋框；台灣福祉目前 10 群，尚可 |
| 資料 | `C452bb99…` 猜錯歸屬 → 補錯 bot | 現在會動的規則變壞 | **P0** | ✅ OQ-2 列為前置，禁止用「現在能送」反推 |
| 隔離 | NULL 租戶的內部事件規則對所有客戶發送 | **跨租戶訊息外洩** | **P0** | ⚠️ 目前無此類規則，但 OQ-6 未裁定前風險存在 |

---

## 附錄 · 來源

- prod 實查（2026-08-12）：`notification_rule` / `line_group` / `line_bot` / `pg_policies` / `app_is_platform_ops()`
- commit `997780f`（LINE `details[]` 已可見）
- [[pitfall_line_ids_are_provider_scoped]] · [[pitfall_line_user_id_multi_tenant]] · [[feedback_novice_comfort_is_the_moat]]
