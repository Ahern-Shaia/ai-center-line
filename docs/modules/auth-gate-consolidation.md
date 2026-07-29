# auth-gate-consolidation · 把剩下的角色白名單收成權限碼

> 📋 **M0 · 盤點完成，待裁定 OQ-AGC-1..3**（2026-07-29）
>
> 觸發：助理登入後側邊欄看得到「資料來源」，點進去畫面渲染出「0 筆客戶」，
> 角落閃一個「角色無權限」。查出來是**側邊欄用權限碼、後端用角色白名單**，兩套對不上。
> 該頁已於 migration 0051 修掉，這份 doc 盤點**其餘同型的**。
>
> 相關：[`permission-engine.md`](permission-engine.md)、[`custom-roles.md`](custom-roles.md)

---

## 0. 一句話結論

**系統有兩套授權表達方式：`@RequirePermission`（102 個端點）與 `@Roles`（11 個）。
側邊欄只認前者。凡是端點用後者、而頁面用前者的地方，兩邊就會錯開 ——
症狀是「看得到、點下去 403」或「有權限、但那個頁面進不去」。**

---

## 1. 為什麼這種錯開特別難發現

錯開**不會壞掉任何測試**，也不會出現在錯誤日誌的顯眼處：

- 使用者看到的是**空狀態或一閃而過的 toast**，不是紅色錯誤頁
- 開發者看程式碼時，兩套宣告分別在**不同檔案**（`Shell.tsx` 與 controller），不會並排出現
- 而且兩邊各自都是對的 —— 錯的是它們對彼此一無所知

`0039_warroom_view_scope.sql` 的註解裡已經記過同一件事一次：
`@Roles("tenant_admin","group_owner","consultant")` 沒放 aiproot，導致 `/warroom` 回 403。

---

## 2. 盤點結果（2026-07-29 · prod 權限資料）

### 2.1 A 類 · 看得到但按不動（會出現 403）

| # | 端點 | `@Roles` 白名單 | 進得去那頁的角色 | 誰會撞牆 |
|---|---|---|---|---|
| **A-1** | `warroom-batch.controller` `POST rerun` | `aiproot_admin, tenant_admin` | 「自動化」頁 `scheduler-config:view` ＝ `aiproot_admin, consultant, tenant_admin` | **consultant** 進得去頁面，按「重跑」403 |
| **A-2** | `employee-binding` `POST tenant/revoke/:id` | `tenant_admin` | 「通訊管道」頁 `binding:aiproot-view` ＝ `aiproot_admin, consultant` | **aiproot_admin / consultant** 看得到解除綁定，按下去 403 |

### 2.2 B 類 · 有權限但那個頁面根本進不去（死權限）

| # | 端點 | `@Roles` 白名單 | 該功能所在頁的 perm | 死在哪 |
|---|---|---|---|---|
| **B-1** | `media.controller` `DELETE/:id`、`POST/:id/restore` | `aiproot_admin, consultant, tenant_admin` | 「素材」頁 `media:view` ＝ `group_owner, tenant_admin` | **aiproot_admin / consultant 連列表都拿不到**（同檔的 GET 是 `@RequirePermission("media:view")`）→ 刪不了自己看不到的東西 |
| **B-2** | `media.controller` `POST/:id/purge` | `aiproot_admin` | 同上 | **唯一能永久刪除的角色，進不去那個頁面** |
| **B-3** | `permission.controller` `GET permissions`、`GET roles` | `aiproot_admin, consultant, tenant_admin` | 「權限管理」頁 `roles:view` ＝ `aiproot_admin, consultant` | `tenant_admin` 有端點權限但看不到頁 —— 無害，但是一條沒人走的路 |
| **B-4** | `signoff.controller` `GET`、`POST` | `tenant_admin, group_owner, consultant` | 任務／儀表頁 `warroom-tasks:view` ＝ `group_owner, tenant_admin` | `consultant` 同上 |

> ⚠️ **B-1 / B-2 是同一個檔案裡兩套機制並存** —— GET 用權限碼、DELETE 用角色白名單。
> 這是最容易再犯的形狀：改的人只會看自己那一行。

### 2.3 一致、不用動

| 端點 | 狀態 |
|---|---|
| `audit.controller` `GET` | `@Roles` 三個角色 ＝ `audit:view` 三個角色 ✅ |
| `employee-binding` `POST self/revoke` | 「解除自己的綁定」對所有登入者開放，語意上就不該綁頁面 ✅ |

---

## 3. 建議

**逐一改成權限碼，一次一個 commit。** 每個都要：

1. 新增對應權限碼（migration），**授予的角色 ＝ 原本 `@Roles` 放行的那些**，不改任何人的實際權限
2. controller 換 `@RequirePermission`
3. 若該功能所在頁的 NAV perm 與新碼不同，**一併對齊**（否則只是把錯開換個位置）
4. `route-guard.test.ts` 會在第 2 步之後立刻標紅 —— 那是預期的，照它的提示補租戶邊界

> ⚠️ **改 `@Roles` 前先看那個功能在哪一頁、那一頁的 perm 是誰。**
> 只改後端會把 A 類（看得到按不動）變成 B 類（有權限進不去），問題沒解決只是換了樣子。

### 3.1 建議順序

| 順位 | 項目 | 理由 |
|---|---|---|
| 1 | **B-1 / B-2（素材刪除）** | 唯一一個**功能實際不可用**的（不是只有難看）· 且兩套機制在同一個檔案 |
| 2 | **A-2（解除綁定）** | aiproot 做客服時真的會按到 |
| 3 | **A-1（重跑批次）** | consultant 會撞到 |
| 4 | B-3 / B-4 | 死權限，無害 · 收乾淨即可 |

---

## 4. 失效場景反思（FMEA · R17）

| # | 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|---|
| **G-1** | 遷移順序 | 程式先上、migration 沒跑 | 權限碼不存在 → **所有人**被擋，連原本有權限的也是 | **P0** | migration 必須先於部署（0051 已踩過這個順序問題並在推之前擋下）|
| **G-2** | 半套 | 只改 controller 沒對齊 NAV | A 類變 B 類，問題換位置不消失 | P1 | §3 第 3 步 · review 時一定要看兩邊 |
| **G-3** | 授予範圍 | 新權限碼順手多給一個角色 | 靜默擴權 | **P0** | 新碼的授予名單**逐字對照**原 `@Roles`，migration 註解寫明「不改變任何人的實際權限」|
| **G-4** | 遺漏 | 改完某些端點，`@Roles` 還剩幾個 | 下一個人以為已經統一了 | P2 | 全部收完後，把 `@Roles` decorator 本身刪掉；在那之前 `route-guard.test.ts` 的盤點數字是唯一的進度指標 |

---

## 5. 開放問題（OQ-AGC-N）

| # | 問題 | 建議 |
|---|---|---|
| **OQ-AGC-1** | 現在收，還是等有人撞到再收？ | **先收 B-1/B-2**（功能實際不可用）· 其餘排進日常 · 不值得為它開一個專門的衝刺 |
| **OQ-AGC-2** | 全部收完後要不要刪掉 `@Roles` decorator？ | **要** · 留著就會有人再用 · 但要等最後一個端點改完 |
| **OQ-AGC-3** | 「素材」頁該給 aiproot / consultant 看嗎？ | **需要你的業務判斷** —— 那是客戶群組裡的照片。若不該給，B-1/B-2 的正解是**把刪除權從他們身上拿掉**，而不是給他們 `media:view` |

---

## 6. 里程碑

| # | 內容 | 依賴 |
|---|---|---|
| **M0** 📋 | 本 doc · 盤點完成 · 待裁定 OQ-AGC-1..3 | — |
| **M1** | B-1 / B-2 素材刪除（含 OQ-AGC-3 的裁定）| OQ |
| **M2** | A-2 解除綁定 · A-1 重跑批次 | M1 |
| **M3** | B-3 / B-4 死權限收乾淨 ＋ 刪 `@Roles` decorator | M2 |

---

## 7. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-29 | v0.1 | M0 · 起於「資料來源」那頁的三套閘門互相不知道對方存在（已由 migration 0051 修掉）· 盤點其餘 11 個 `@Roles` 端點，找到 **5 處錯開**，分兩類：A 類「看得到但按不動」（consultant 重跑批次、aiproot 解除綁定）、B 類「有權限但頁面進不去」（**素材刪除是唯一功能實際不可用的** —— GET 用權限碼、DELETE 用角色白名單，兩套在同一個檔案，能刪的人拿不到列表）· ⭐ 提出改的紀律：只改後端會把 A 類變成 B 類，問題換位置不消失，必須連 NAV 的 perm 一起對齊 · FMEA 含 2 個 P0（migration 順序、新碼順手擴權）| ahern + Claude Code |
