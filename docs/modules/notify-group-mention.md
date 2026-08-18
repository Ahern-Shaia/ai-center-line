# 設計文件 · LINE 群組通知 @ 當事人（M0）

> 狀態：✅ **M0 APPROVED v0.2**（2026-08-18）· **OQ-NGM-1..8 全採建議** · 下一步 M0.5 覆蓋率 gate
> UI mockup：[`../mockup/notify-group-mention-flow.html`](../mockup/notify-group-mention-flow.html)（待 review）
> 對象：`notification_rule`、`notify/line.client.ts`、`notification-hub/channels/line.sender.ts`、通知設定精靈（`web/src/notify-config/Wizard.tsx`）、新端點「列出某群成員」
> 相關：[`notify-bot-scoped-target.md`](notify-bot-scoped-target.md)、[`notification-hub.md`](notification-hub.md)、[`employee-line-binding.md`](employee-line-binding.md)、[`task-assign-notify.md`](task-assign-notify.md)
>
> **一句話**：群組通知現在只會發一則所有人都看得到、但沒有人被指名的訊息。
> 要 @ 到人需要 LINE userId，而 userId **依 bot（provider）發放** ——
> 用戶提的解法是把既有的「選 bot → 選群」再延一段成「→ 選該群成員」，
> 讓 userId 與發送用的 bot **同源**，provider 一致變成結構保證，而不是靠人記得選對。

---

## 1. 觸發事件（2026-08-18 · 用戶提問）

> 「LINE 通知有辦法設定表單 @通知的人 在群組中嗎？」
> 「可以先選 LineBot、再選群組（這兩個已經做了），然後再依照群組選 user？」

第一版回答我把路徑想長了 —— 說要走「Ragic 欄位的人名 → 比對員工 → 查綁定表」，
而那條路會撞上 2026-07-29 定過的紅線（**禁用暱稱模糊比對**，@ 錯人比不 @ 嚴重）。

用戶提的路徑短得多，而且**繞開了名字比對**：直接從該群的成員清單挑人，拿到的就是
可以直接用的 userId。查驗後確認第三段所需的資料**早就在庫裡**（§2）。

---

## 2. 既有現況走查

| 段落 | 現況 | 證據 |
|---|---|---|
| 選 bot → 選群 | ✅ **已做** | `Wizard.tsx` · 群組下拉在未選 bot 前 disabled · commit `0f4cb3d` |
| 群 → 成員的**資料** | ✅ **已有** | `line_member` · `UNIQUE (bot_id, group_id, user_id)` + `display_name` / `picture_url` / `fetch_error`（migration 0015）|
| 群 → 成員的**端點 / UI** | ❌ 沒有 | 目前只在 `line-bot.service.ts:199` 數人數，沒有把名單吐出來的 API |
| 送 mention | ❌ 沒有 | `notify/line.client.ts:49` 只送 `{ type: "text", text }` |
| 指派任務時「已經有 userId」 | ⚠️ **前提要更正** | `tickets.assignee_user_id` 是**系統帳號 uuid**（`users.user_id`），不是 LINE userId |

### 2.1 為什麼 `line_member` 正好是對的資料

它的唯一鍵就是 `(bot_id, group_id, user_id)` —— 跟 mention 需要的三元組完全一致。
更重要的是**這些 userId 是那支 bot 自己用自己的 token 抓回來的**
（`member-fetch.service.ts` → `getGroupMemberProfile`），所以拿去給**同一支 bot** 發 mention，
provider 必然一致。這不是「記得選對」，是資料來源決定的。

> 對照 [[pitfall_line_ids_are_provider_scoped]]：換 provider 的 bot 進同一個群＝全新一組 ID。
> 只要 UI 強制「先 bot → 再群 → 再成員」，跨 provider 混用在**取值階段就不可能發生**。

### 2.2 三種身分資料的分工（別搞混）

| 表 | 有什麼 | 涵蓋誰 | 這個模組用得到嗎 |
|---|---|---|---|
| `line_member` | `(bot, group, line_user_id)` + LINE 暱稱 | **在該群發過言的人** | ✅ 這就是 @ 的對象來源 |
| `user_line_binding` | `line_user_id` ↔ 系統帳號 | 走完 LIFF 綁定的員工 | 加分項：把暱稱換成員工姓名 |
| `users` | 系統帳號 | 全員 | 不直接用（沒有 LINE 身分）|

⭐ **關鍵結論：@ 只需要第一張表。綁定是加分，不是前提。**
這讓這個功能可以在綁定率還低的時候就先能用 —— 跟 `task-assign-notify` 卡在
「7/45 張任務指得到有帳號的人」不同，那裡的瓶頸是**帳號數**，這裡沒有那個瓶頸。

---

## 3. LINE API 事實（查證 2026-08-18）

送 mention 要用 **`textV2`** 訊息型別（不是既有的 `text`），mention 走 `substitution`：

```json
{
  "type": "textV2",
  "text": "{p1} 這張維修單指派給你",
  "substitution": {
    "p1": { "type": "mention", "mentionee": { "type": "user", "userId": "U4af4980629..." } }
  }
}
```

`mentionee.type` 可為 `user`（需 `userId`）或 `all`（@ 全體）。
端點不變，仍是 `POST /v2/bot/message/push`。

來源：[`line/line-openapi` messaging-api.yml](https://github.com/line/line-openapi/blob/main/messaging-api.yml)
的 `TextMessageV2` / `MentionSubstitutionObject` / `UserMentionTarget` / `AllMentionTarget`。

### 3.1 兩件**沒有**查證到、M1 必須實測的事

| 未知 | 為什麼重要 | 怎麼測 |
|---|---|---|
| 送出端一則最多幾個 mention | 搜尋到的「上限 20」是**webhook 收訊側**的描述，送出端 spec 沒寫 | 測試群塞 21 個看回什麼 |
| 被 @ 的人**不在該群**時的行為 | 決定「離職／退群的人還留在規則裡」會怎樣：整則失敗？還是照送但不生效？ | 用退群者的 userId 實送一次 |

> 寫進文件是因為這兩題的答案會改變 §5.2 的 fallback 設計。**不要猜，M1 第一件事就是測。**

### 3.2 一個結構性限制（會決定 UI 文案）

`line_member` 只有**開過口的人** —— 它是 webhook 收到訊息時 fire-and-forget 去抓的
（`line-webhook.service.ts:312`），潛水成員一列都沒有。

而 LINE 能一次撈全群名單的 `/v2/bot/group/{groupId}/members/ids`
**只開放認證帳號或付費帳號**（[Get user IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)）。

所以下拉**會缺人，而且缺的樣子看不出來** —— 看起來就像那個人不在群裡。
這是 [[pitfall_green_because_empty]] 的同一個形狀：空的清單不代表沒有人。

---

## 4. M0.5 · 動工前的 gate（比照 media-and-vision）

**先查 prod：每個群的 `line_member` 覆蓋了多少人。**

```sql
SET LOCAL app.actor_role = 'aiproot_admin';   -- 不設會被 RLS 靜默擋成 0 列
SELECT g.display_name AS 群組,
       count(*) FILTER (WHERE m.fetch_error IS NULL) AS 可選成員,
       count(*) FILTER (WHERE m.fetch_error IS NOT NULL) AS 抓取失敗,
       max(m.last_seen_at) AS 最近活動
FROM line_member m
JOIN line_group g ON g.group_id = m.group_id AND g.bot_id = m.bot_id
GROUP BY g.display_name
ORDER BY 2 DESC;
```

判準：**若多數群的可選成員只有個位數**（例如 20 人的群只認得 4 個），
那麼 UI 做出來會讓主管找不到要 @ 的人，功能等於半殘 —— 這時應該先解涵蓋率
（OQ-NGM-6 的主動補抓，或去把官方帳號認證起來），再做 UI。

> 這一步的存在理由跟 media-and-vision M0.5 一樣：**先確認資料撐得起功能，再花力氣做介面。**

---

## 5. 設計

### 5.1 資料模型

`notification_rule` 加一欄（migration 0065）：

```sql
ALTER TABLE notification_rule
  ADD COLUMN IF NOT EXISTS mention jsonb;
-- {
--   "targets": [ { "lineUserId": "U...", "displayNameSnapshot": "小星星" } ],
--   "mentionAll": false
-- }
-- NULL / 缺欄 = 不 @（既有規則行為完全不變）
```

**為什麼存 `displayNameSnapshot`**：LINE 暱稱隨時可改。通知紀錄要能回答
「當時畫面上顯示的是誰」，不能只留一串 `U...` 讓人事後對不出來。
（同 `notification_log` 記 `ruleLabel` 的理由。）

**為什麼不另開表**：一條規則的 @ 名單是它的設定，不是獨立實體；
沿用 `notification_rule` 的 RLS 與稽核，不必再驗一次租戶邊界。

⚠️ **刻意 nullable** —— 比照 0061 `bot_id` 的教訓（[[pitfall_required_field_with_no_legal_value]]）：
加必填欄位前要先確認既有資料填得出合法值，這裡填不出，所以不設 NOT NULL。

### 5.2 邏輯

```
規則有 mention.targets → 組 textV2 + substitution → push
                       ↘ 組裝失敗 / 名單為空 → 退回既有的 { type: "text" }
```

⭐ **鐵則：mention 出任何問題都不得把通知本身弄丟。**
這是本模組唯一的 P0 —— 現在會動的通知是客戶每天在用的，
為了「@ 不到人」而讓整則訊息送不出去，是把一個小遺憾換成一個事故。

實作上 `LineClient.pushText` 擴成 `pushMessage(cfg, message)`，
`text` 與 `textV2` 兩種 message 物件都走同一條錯誤處理（`describeLineError` 的 `details[]` 已可見，commit `997780f`）。

### 5.3 UI

精靈「管道」那一步，選完群組後多一個欄位：

```
用哪支機器人發送  [鮮湧 · 鮮湧AI客服        ▾]
LINE 目標群       [業助群                  ▾]
要 @ 的人（選填）  [＋ 小星星  ＋ 佳慧          ]   ← 多選 · 來源 = 該 (bot, group) 的 line_member
                  只列出在本群發言過的成員 · 找不到人？請他在群裡發一則訊息
```

- 抓 profile 失敗的列（`fetch_error IS NOT NULL`、`display_name` 是假名「成員_xxxxxx」）**不進選單**
- 有綁定的顯示「王小明（小星星）」，沒綁定只顯示暱稱（OQ-NGM-3）
- 沿用既有 `StyledSelect` / 精靈版式，不 invent 新元件（[[feedback_reuse_project_ui_conventions]]）

---

## 6. 新端點

```
GET /notify-config/bots/:botId/groups/:groupId/members
→ [{ lineUserId, displayName, boundUserName | null, lastSeenAt }]
```

- 權限：`notify-config:manage`（同精靈其餘端點）
- ⚠️ **RLS 不是這裡的保護**：`line_member` 的 policy 對 `aiproot_admin` / `consultant` / `system` 是**放行的**
  （0015 policy 的 OR 分支），而這個端點的使用者正好是那些角色 ——
  所以 service 層**必須自己**用 `botId` 綁住租戶（bot 屬於哪個租戶是已知的），不能只靠 RLS。
  這是 [[pitfall_permission_code_is_not_tenant_boundary]] 的同一課：權限碼不是租戶邊界。
- 回傳含 LINE userId 與暱稱＝**PII**（0015 的 COMMENT 自己就標了「客戶需明確授權」），
  因此本端點需進 `audit_log`（R5）。

---

## 7. 企業級 cross-cutting

### 7.1 安全模型
- **@ 錯人的後果是公開的** —— 群裡所有人都看到你把單子指給錯的人。故 userId 一律只從
  `(bot_id, group_id)` 撈，存規則時再驗一次「這個 userId 屬於這條規則的 bot＋群」
- 成員名單端點含 PII → 權限 + 租戶 scope + audit（§6）
- 不做名字模糊比對（[[project_onboarding_requires_line_binding]] 的 A-2 P0）

### 7.2 容量
台灣福祉最大群約 20-40 人，`line_member` 全表 3 位數量級 —— 下拉不需要分頁，但需要搜尋框。

### 7.3 成本
LINE 推播計費看**訊息則數**，mention 不額外收費，故成本增量為 0。
真正的成本是**注意力**：被 @ 的人會收到推播。若同一張單改三次就 @ 三次，
兩天內對方就會把群組通知關掉 —— 那比不 @ 更糟。故 @ 必須是**每條規則各自的開關**（OQ-NGM-5）。

### 7.4 觀測
`notification_log` 要記「這則 @ 了誰」，否則事後無法回答「他說沒收到通知」。
⭐ 這跟既有待辦「`notification_log` 加 `bot_id`」是同一張表、同一類缺口，**建議併成同一支 migration 一次做完**。

### 7.5 向後兼容
`mention IS NULL` ＝ 現行行為，一個字都不變。前端舊版不送這個欄位時，repository 語意必須是
「不動」而非「清空」—— 這正是 `ragicAccountId` 那次踩過的坑（[[pitfall_ui_field_never_sent]]），
且同一支 `ncUpdateRule` 目前**還有兩個欄位是漏送的**，實作時一併補（見任務 #16）。

---

## 8. 測試策略

| 層 | 案例 |
|---|---|
| unit | `mention.targets` 空 / NULL → 送 `text` 而非 `textV2` |
| unit | 組裝失敗（substitution key 對不上）→ fallback 純文字，且**不得 throw** |
| unit | 存規則時 userId 不屬於該 (bot, group) → 400 並指名原因 |
| unit | 更新規則未帶 `mention` → 既有名單不被清空 |
| 整合 | 端點只回本租戶的成員（帶別家 botId → 403/空）|
| **真實** | §3.1 兩個未知數各實測一次 —— **這兩題沒測完不算 M1 完成** |

---

## 9. 落地順序

| 里程碑 | 內容 |
|---|---|
| **M0** | 本文 · 待裁定 OQ-NGM-1..8 |
| **M0.5** | prod 查 `line_member` 覆蓋率（§4）· **這是 gate，結果不好就先不做 UI** |
| **M1** | 實測 §3.1 兩個未知 → migration 0065 → `pushMessage` 支援 `textV2` + fallback |
| **M2** | 成員端點（含租戶 scope + audit）+ 精靈多選 UI |
| **M3** | `notification_log` 記 @ 了誰（與 `bot_id` 併一支 migration）|
| **M4** | FMEA 覆核（R17）+ 文件收尾 + MODULES.md 標 ✅ |

---

## 10. 開放問題（OQ-NGM-N）— ✅ 2026-08-18 全採建議

> 下欄「建議」即為裁定結果。UI 落地形狀見
> [`../mockup/notify-group-mention-flow.html`](../mockup/notify-group-mention-flow.html)。

| # | 問題 | 裁定（＝原建議）|
|---|---|---|
| **1** | @ 名單是「規則固定」還是「依 Ragic 欄位動態決定」？ | **A 固定名單**。動態要拿欄位裡的人名去比對，正好撞禁用模糊比對那條線；等 Ragic 那格改成「選單」而不是「打字」再談 |
| **2** | 成員清單要不要含**沒有系統帳號**的人？ | **要**。排除就等於把功能綁回綁定率，而 §2.2 的結論正是這裡不需要綁定 |
| **3** | 暱稱怎麼顯示？ | 有綁定「王小明（小星星）」· 無綁定只顯示暱稱並標「未綁定」——讓主管自己判斷，不替他猜 |
| **4** | 要不要開放 @全體（`mentionee.type = all`）？ | **不開**。一鍵吵全群、收不回來，且與「LINE 群組一律不出聲」的克制取向衝突（[[project_line_group_never_speaks]]）。真要吵全群，用戶自己在群裡打字更快 |
| **5** | @ 是每條規則的開關，還是全域設定？ | **每條規則**。理由見 §7.3 |
| **6** | 成員名單怎麼補涵蓋率？ | v1 只靠 webhook 被動累積 + UI 明說限制；主動補抓要逐人打 profile API（LINE 免費額度 1000/月），視 M0.5 結果再定 |
| **7** | 被 @ 的人退群 / 離職怎麼辦？ | 依 §3.1 實測結果定。原則：**不擋通知**，記 log，UI 標「此人可能已不在群」 |
| **8** | `notification_log` 記 @ 名單要不要跟 `bot_id` 併一支 migration？ | **併**。同一張表、同一類缺口，分兩次做要動兩次 prod |

---

## 11. 失效場景反思（FMEA · R17 · M0 版）

| 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|
| 發送 | mention 組裝錯誤 → 整則 400 | **現行通知全停** | **P0** | ⚠️ §5.2 強制 fallback 純文字；任何 mention 例外不得往上拋 |
| 發送 | 用了別支 bot 的 userId | @ 到不存在的人 / 錯的人 · **群內公開** | **P0** | ✅ 結構緩解：只從 `(bot_id, group_id)` 撈 + 存檔再驗一次 |
| 端點 | 成員名單沒做租戶 scope | **跨租戶 PII 外洩**（別家群成員的 userId + 暱稱）| **P0** | ⚠️ RLS 對 aiproot 角色是放行的，**service 層必須自己 filter**（§6）|
| 資料 | 潛水成員不在名單 | 主管以為那人不在群、改用 @全體或放棄 | P1 | ⚠️ M0.5 先量；UI 明說「只列發言過的成員」 |
| 資料 | 暱稱與真名對不上 → 選錯人 | 指派給錯的人 | P1 | ⚠️ OQ-3 顯示綁定姓名；對不到就顯示「未綁定」讓人自己判斷 |
| 更新 | 前端沒送 `mention` → 名單被清空 | 靜默失效（存檔成功、@ 消失）| P1 | ✅ repository 語意「未帶＝不動」+ 測試（[[pitfall_ui_field_never_sent]]）|
| 打擾 | 同一單反覆異動 → 反覆 @ | 對方關掉群組通知 · **連原本有效的通知一起失去** | P2 | ⚠️ 每規則開關（OQ-5）；量測後再考慮節流 |
| 部署 | 前端先上、後端未支援 | 存了 `mention` 但不會 @ | P2 | ✅ 順序：migration → 後端 → 前端 |

**M0 結論：三個 P0 中兩個有結構解，一個（fallback）是實作紀律，需在 M1 的測試裡固定下來。**

---

## 12. 變更紀錄

| 日期 | 版本 | 變更 |
|---|---|---|
| 2026-08-18 | v0.1 | M0 DRAFT · 用戶提「bot → 群 → 成員」三段式；查驗確認前兩段已有、第三段資料已在庫；待裁定 OQ-NGM-1..8 |
| 2026-08-18 | v0.2 | 用戶「全採建議」裁定 OQ-NGM-1..8 · 加 UI flow mockup（`mockup/notify-group-mention-flow.html`）待 review |
