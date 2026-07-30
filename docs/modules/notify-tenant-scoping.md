# notify-tenant-scoping · 通知設定開放給總經理

> 狀態：📋 **M0 DRAFT v0.1**（2026-07-30）· 待用戶裁定 OQ-NTS-1..4
>
> 相關：[`../roles-permissions-matrix.md`](../roles-permissions-matrix.md) §6、
> [`member-department-assignment.md`](member-department-assignment.md)（同一波「客戶自治」下放）
>
> ⚠️ 動 RLS policy（誰看得到哪些通知規則），依 R6 先 design 再實作。

---

## 1. 目標

讓**總經理（tenant_admin）自己**管自家的通知規則（Ragic 異動 → LINE），
不用每次找 aiproot。這是 [[feedback-tenant-self-governance]] 的又一個實例
（延續 depts/members、master-data、成員部門分配）。

## 2. ⚠️ 先更正一個我自己的誤判

我 2026-07-30 一度說「`notify_rule` 沒有 tenant_id/RLS，開給 T 會**跨租戶洩漏**」——
**那是錯的**，因為我查了一個不存在的表名（`notify_rule`），空結果被誤讀成「沒有欄位」。

實際查證（prod）：

| 表 | tenant_id | RLS | policy |
|---|---|---|---|
| `notification_rule` | ✅ | ✅ | `app_is_platform_ops()` |
| `notify_config` | ✅ | ✅ | `app_is_platform_ops()` |
| `notification_log` | ✅ | ❌ 無 RLS | — |

所以真相是：**RLS 是「平台專屬」不是「租戶隔離」**。
`app_is_platform_ops()` 只放行 aiproot/consultant/system。
→ 直接把 `notify-config` 權限開給 tenant_admin **不會洩漏**（他會被 RLS 擋成看到 **0 列**，
   [[rule-rls-silent-zero]] 的形狀），但也**不能用**。要能用得加一條租戶分支。

## 3. 要改什麼

### 3.1 RLS · 加租戶分支（核心）

```sql
-- notification_rule / notify_config：平台可看全部 OR 看自己租戶的
--   app_is_platform_ops() OR tenant_id = current_tenant
```
既有的平台行為不變（`app_is_platform_ops()` 還在），只是多讓租戶看自己的。
`notification_log` 目前**無 RLS** —— 開放前要補（否則 tenant_admin 看得到全平台的送信紀錄）。

### 3.2 權限授予

`notify-config:view` / `notify-config:manage` 加給 `tenant_admin`。
（目前是 A / C / assistant —— §矩陣 3.3）

### 3.3 ⚠️ 端點稽核（別漏 withSystemTx）

`notify-config.controller.ts` 多數端點用 `resolveTenantId`（tenant_admin 鎖自租戶，安全）。
但**必須逐一稽核**：任何用 `withSystemTx` 或直接吃 client `tenantId` 而不 resolve 的端點，
在開放給 tenant_admin 後就是跨租戶洞。這是動手前的 P0 前置。

### 3.4 UI

通知設定頁原本是 aiproot 跨租戶視角（可能有選 tenant 的下拉）。
tenant_admin 進去應**自動鎖自己租戶、不顯示 tenant 選擇**。

## 4. 站在巨人肩膀上

同 [[member-department-assignment]] §3：這是標準的**多租戶 row-level 隔離**下放。
差別是 notify 的資料模型**已經是租戶化的**（有 tenant_id），只是 RLS 當初寫成平台專屬 ——
所以工作量比 MDA 更小（不用加欄、不用回填），核心就是「RLS 加一條 OR」+ 端點稽核。

## 5. FMEA（P0 先列）

| 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|
| 某端點用 withSystemTx 繞過 RLS，開放後 T 看到別家規則 | 跨租戶洩漏（含 Ragic 金鑰）| **P0** | 🔒 §3.3 逐端點稽核 · 測試：T 只看得到自己租戶的規則 |
| `notification_log` 無 RLS，開 logs 給 T → 看到全平台送信紀錄 | 跨租戶洩漏 | **P0** | 🔒 開放前先補 log 的 RLS |
| Ragic 金鑰跨租戶可見 | 洩漏客戶憑證 | **P0** | 🔒 金鑰在 notify_config，RLS 租戶分支涵蓋它；稽核金鑰端點 |

## 6. 里程碑

| # | 內容 |
|---|---|
| **M0** 📋 | 本文件 · 待裁定 OQ-NTS-1..4 ← 在這 |
| **M1** | 端點稽核（找出所有繞過 resolveTenant 的）+ notification_log 補 RLS |
| **M2** | RLS 加租戶分支 + 授權 tenant_admin + UI 鎖自租戶 |
| **M3** | FMEA 覆核（三個 P0）+ 上線 |

## 7. 開放問題（OQ-NTS-N）

| # | 問題 | 建議 |
|---|---|---|
| **OQ-NTS-1** | 現在就做，還是先擱著（aiproot 代設也行）？ | 可**緩** —— MDA 已解客戶最痛的「分配成員」；notify 客戶目前用量低，代設可接受。等有客戶要求再排 |
| **OQ-NTS-2** | assistant 角色怎麼辦（它現在是 notify 專屬窄角色）？ | 保留 —— 開放 T 之後 assistant 仍可存在（給沒有總經理權限、只管通知的人）|
| **OQ-NTS-3** | Ragic 帳號金鑰能不能讓 T 自己填？ | 傾向可以（是他自己公司的 Ragic）· 但金鑰稽核要確認 RLS 覆蓋 |
| **OQ-NTS-4** | notification_log 開不開給 T？ | 開，但**先補 RLS**（P0）· 客戶想看自己的送信成敗合理 |

## 8. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-30 | v0.1 | M0 首版 · ⚠️ **更正自己的誤判**：先前說「notify 無 tenant_id/RLS 會洩漏」是查錯表名（`notify_rule` 不存在），實際 `notification_rule`/`notify_config` 都有 tenant_id + RLS，只是 policy 是 `app_is_platform_ops()`（平台專屬）· 所以開給 T 不洩漏但看不到，要加租戶分支 · 工作量比 MDA 小（資料已租戶化）· 三個 P0 都是「開放前先確認沒有繞過 RLS 的路徑」（端點 withSystemTx 稽核、notification_log 補 RLS、金鑰 RLS 覆蓋）· OQ-NTS-1 建議可緩 | ahern + Claude Code |
