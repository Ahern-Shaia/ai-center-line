# permission-engine.md — [P1] 權限細度分配設計文件

> 🚧 **狀態：DRAFT — 待用戶裁定 OQ-PE-1..12（2026-07-21）**
>
> 把「4 個 hardcoded role」升級成「RBAC extensible」·  4 個內建 role 保留為 template · 未來 tenant 可自訂 role · 每個 role 由 (resource, action) permission 組成 · 支援 fine-grained UI gating。
>
> 目前狀態：所有 endpoint 用 `@Roles(...)` 白名單擋 · 前端 sidebar 用 `session.role === "X"` 判斷 · 沒有「這 role 可以 view 但不能 edit」的粒度 · 也沒有「自訂 role」的能力。
>
> 這是與 [[tenant-provisioning]] 平行的**第三隻腳 IAM** · 一起完整才叫 SaaS 商用 baseline。
>
> 作者：Claude Code（草擬）｜版本：v0.1（2026-07-21）

---

## 1. 目標與範圍

### 1.1 目標

1. **RBAC 落地**：把 `@Roles(...)` 白名單改成 `@RequirePermission(resource, action)` · 全 endpoint 統一 permission check
2. **4 個 built-in role 變 template**：aiproot_admin / consultant / tenant_admin / group_owner 仍存在 · 但改由 permission set 定義（不 hardcoded）
3. **Frontend permission gate**：`<PermGate perm="line-bots:create">...</PermGate>` · 前端統一用 permission 判 UI 顯示 · 不再零散寫 `role === "aiproot_admin"`
4. **完整 audit**：permission 變更 · role 指派 · 所有進 audit_log
5. **保留擴充路徑**：Phase 2 加「tenant 自訂 role」+「per-user permission override」不用大 refactor

### 1.2 對應現況痛點

| 現況 | 痛 |
|---|---|
| `@Roles("aiproot_admin", "consultant", "tenant_admin")` 到處寫 | 加新 role 或改權限要 grep 全 codebase |
| 前端 `session.role === "aiproot_admin" && ...` 散布 | 沒統一 gate · 漏擋一處就露 |
| Tenant 想「主管副手」read-only 存取 · 做不到 | 客戶要 flex · 我方 rigid |
| Group owner 全能簽核 own dept · 但 tenant_admin 想給他「只讀」試用 3 天 | 不可能 |

### 1.3 不做的事（Phase 1 邊界）

- ❌ **ABAC / dynamic permission**（如「上班時間才能改」「主管才能簽核 > $10k 的單」）· Phase 3+
- ❌ **ReBAC / relationship graph**（Google Zanzibar 那種）· 過度設計
- ❌ **UI 完全自由編輯 permission matrix** — Phase 2 · 現階段 aiproot 靠 CLI 或 SQL 加 role
- ❌ **Field-level permission**（「你可看 ticket 但不看金額欄位」）· Phase 3+
- ❌ **Time-bounded permission**（Y 到 Z 期間才有權）· Phase 3+
- ❌ **Permission delegation**（我把我的權限暫借給你）· 太複雜
- ❌ **多 role per user** — Phase 1 一 user 一 role · Phase 2 才加 secondary roles

---

## 2. 上游 / 既有現況走查

| 元件 | 現況 | Gap |
|---|---|---|
| `roles.decorator.ts` + `roles.guard.ts` | ✅ 有 · Nest guard 白名單擋 role | 保留 · 內部改用 permission service · 對外仍 export `@Roles` 做 backward compat |
| `session.role` | ✅ JWT payload · frontend / backend 都用 | 保留 · 但 frontend 加 `session.permissions?: string[]` |
| Frontend UI gating | 分散在 20+ 檔案 · 例：`Shell.tsx` `LineBots.tsx` `DepartmentsMembers.tsx` | 統一用 `<PermGate>` helper |
| audit_log | 有 pattern · 但沒 permission 事件 | 新 action：`role_assigned` / `role_updated` / `permission_denied` |
| 資料庫 | `users.role` (text · single value) | 保留 · 加 3 表 |

---

## 3. 資料模型

### 3.1 新表（Phase 1 · Level 2）

```sql
-- Migration 0010_permission_engine.sql

-- 靜態 · 由 aiproot 定義 · 對應 code 中所有可執行 action
CREATE TABLE permissions (
  permission_id   text PRIMARY KEY,           -- e.g. 'line-bots:create' · 'warroom:view'
  resource        text NOT NULL,               -- 'line-bots'
  action          text NOT NULL,               -- 'create' / 'view' / 'update' / 'delete'
  description     text NOT NULL,               -- 「新增 LINE 機器人」給 UI 顯示
  scope           text NOT NULL DEFAULT 'tenant'
    CHECK (scope IN ('platform', 'tenant', 'department')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Built-in system role + 未來 tenant 自訂 role · Phase 1 只塞 built-in
CREATE TABLE roles (
  role_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key        text NOT NULL,               -- 'aiproot_admin' · 'tenant_admin' · 或 tenant 自訂 'reader'
  role_name       text NOT NULL,               -- 顯示名 · 「AIPROOT 管理員」
  tenant_id       uuid REFERENCES tenants(tenant_id) ON DELETE CASCADE,
                                               -- built-in NULL · tenant 自訂綁該 tenant
  is_system       boolean NOT NULL DEFAULT false,  -- 內建不可刪
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON roles (role_key, tenant_id NULLS NOT DISTINCT);

-- Role ↔ Permission join
CREATE TABLE role_permissions (
  role_id         uuid NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  permission_id   text NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Phase 2 · Per-user override（保留 hook · Phase 1 不建 UI）
-- CREATE TABLE user_permission_overrides (...);
```

### 3.2 `users.role` 遷移

- Phase 1 · 不改 `users.role` column · 保留字串（backward compat）
- 新增 `users.role_id` uuid（nullable · 未來遷完可 drop 舊 column）
- 兩者短期並存 · 讀 auth service 優先看 role_id · fallback role 字串
- Phase 2 完 · drop `users.role`

### 3.3 種子資料（migration 內 · Level 2 baseline）

```sql
-- 4 built-in roles
INSERT INTO roles (role_key, role_name, is_system, tenant_id) VALUES
  ('aiproot_admin', 'AIPROOT 管理員', true, NULL),
  ('consultant', '顧問', true, NULL),
  ('tenant_admin', '總經理室', true, NULL),
  ('group_owner', '群組負責人', true, NULL);

-- Permissions (從 code 中 grep @Roles / 抽出所有 resource-action) · 舉例：
INSERT INTO permissions VALUES
  ('line-bots:view', 'line-bots', 'view', '檢視 LINE 機器人', 'platform'),
  ('line-bots:create', 'line-bots', 'create', '新增 LINE 機器人', 'platform'),
  ('line-bots:update', 'line-bots', 'update', '編輯 LINE 機器人', 'platform'),
  ('line-bots:delete', 'line-bots', 'delete', '停用 LINE 機器人', 'platform'),
  ('line-groups:assign', 'line-groups', 'assign', '分派 LINE 群到部門', 'platform'),
  ('warroom:view', 'warroom', 'view', '檢視戰情室', 'tenant'),
  ('signoff:action', 'signoff', 'action', '簽核 tickets', 'tenant'),
  ('departments:view', 'departments', 'view', '檢視部門', 'tenant'),
  ('departments:manage', 'departments', 'manage', '管理部門 (CRUD)', 'tenant'),
  ('users:view', 'users', 'view', '檢視使用者', 'tenant'),
  ('users:manage', 'users', 'manage', '管理使用者 (CRUD)', 'tenant');
  -- ...約 30-50 條

-- Role-Permission mapping (built-in 4 role)
-- aiproot_admin · 全部 · consultant · 全 view · tenant_admin · own tenant 全 · group_owner · own department view + signoff
```

### 3.4 down migration

```sql
ALTER TABLE users DROP COLUMN role_id;
DROP TABLE role_permissions;
DROP TABLE roles;
DROP TABLE permissions;
```

---

## 4. Backend 設計

### 4.1 Permission service

```typescript
@Injectable()
export class PermissionService {
  // Cache 每 role 的 permission set · TTL 5min · 更新時 invalidate
  private cache = new Map<string, Set<string>>();

  async userHas(userId: string, permId: string): Promise<boolean> {
    const perms = await this.getUserPermissions(userId);
    return perms.has(permId);
  }

  async getUserPermissions(userId: string): Promise<Set<string>> {
    // 1. 找 user.role_id · fallback user.role 字串 map 到 built-in role
    // 2. 查 role_permissions
    // 3. Cache 5 min
  }
}
```

### 4.2 新 decorator `@RequirePermission`

```typescript
@Controller("line-bots")
export class LineBotController {
  @Post()
  @RequirePermission("line-bots:create")   // 取代 @Roles("aiproot_admin")
  async create(...) { ... }
}
```

### 4.3 Backward compat · 保留 `@Roles`

Phase 1 · `@Roles` 內部 delegate 到 `@RequirePermission` · code 逐步遷移。Phase 2 · 全遷完後 deprecate `@Roles`。

### 4.4 API endpoints（本模組新）

| Method | Path | 用途 |
|---|---|---|
| GET | `/permissions` | 列所有 permissions（給 UI 建 role 用） |
| GET | `/roles?tenantId=xxx` | 列 roles（built-in + tenant 自訂） |
| POST | `/roles` | 新增 tenant 自訂 role（Phase 2 UI · Phase 1 skip） |
| GET | `/roles/:id` | 詳情 · 含 permissions |
| PATCH | `/roles/:id/permissions` | 更新 role 的 permission set（僅 non-system role） |
| GET | `/me/permissions` | 目前登入使用者的完整 permission set（Frontend 用） |

---

## 5. Frontend 設計

### 5.1 `<PermGate>` helper

```tsx
<PermGate perm="line-bots:create">
  <button>+ 新增機器人</button>
</PermGate>

// 或多條件
<PermGate any={["line-bots:update", "line-bots:delete"]}>
  ...
</PermGate>
```

Backed by `usePermissions()` hook · call GET `/me/permissions` once on login · cache in context。

### 5.2 side effect · 現有的 role check 全遷移

- `Shell.tsx` NAV filter：`session.role === "aiproot_admin"` → `hasPermission("line-bots:view")`
- `App.tsx` onNav guard 同上
- 各頁面 canEdit 判斷同上

### 5.3 aiproot 側 · 「權限管理」頁（Phase 2 · 現階段 skip UI）

- 進「AIPROOT 管理」→ 選 tenant → 看該 tenant 的 role 列表
- 每個 role 右邊 [編輯] · 展開 permission checkbox grid
- Custom role 可新增 · built-in 唯讀
- 使用者 → role 指派介面

Phase 1 不做 UI · aiproot 用 SQL 手動改 role_permissions（極少需要）· 有需求再上 Phase 2。

---

## 6. 資料流

### 6.1 使用者登入後拿 permission

```
Login → JWT (含 userId + role_id)
  ↓
Frontend on mount → GET /me/permissions
  ↓
Backend PermissionService.getUserPermissions(userId)
  ↓ (cache 5 min)
Return { permissions: ["warroom:view", "signoff:action", ...] }
  ↓
Frontend cache in PermissionContext
  ↓
<PermGate perm="X"> 檢查 · 顯示或隱藏 UI
```

### 6.2 API call

```
User POST /line-bots
  ↓ JWT guard 過
Global PermissionGuard 檢查 @RequirePermission("line-bots:create")
  ↓ PermissionService.userHas(userId, "line-bots:create")
  ↓ true → 進 handler
  ↓ false → 403 + audit "permission_denied"
```

### 6.3 Tenant 自訂 role（Phase 2）

```
aiproot 進 tenant 的 role 管理頁
  ↓ 新增「品保主管」role
  ↓ 勾 permissions: ["warroom:view", "signoff:action"] (只讀簽核)
POST /roles + PATCH /roles/:id/permissions
  ↓ audit "role_created"
  ↓ Cache invalidate for this tenant
UI 更新 · 該 tenant 的 user 可指派這 role
```

---

## 7. 安全模型

### 7.1 Permission escalation 防護

- Tenant_admin 建自訂 role 時 · 該 role 的 permissions **不能超過 tenant_admin 自身**（不能給下屬更大權）
- Backend check：新 permissions ⊆ actor.permissions
- 若 tenant_admin 想給下屬 aiproot 級 permission · 401

### 7.2 System role 保護

- `is_system=true` 的 role · 不能透過 API 改 permissions
- Migration 種子後鎖定 · 只能 SQL owner 手動改

### 7.3 Cache invalidation

- 改 role_permissions · 立刻 invalidate 該 role 的 cache
- 改 user.role_id · 立刻 invalidate 該 user 的 cache
- Session 內 permission set 若已 5 min 內 · 舊 permission 仍有效（trade-off · 短時間內容忍）
- **關鍵操作**（如 delete tenant · payment）· backend 每次即時查 · 不 cache

### 7.4 Audit

- role 指派 / 修改 / permission 變更 → audit_log
- Permission denied（如攻擊者拿舊 token 打 endpoint） → audit_log with severity

---

## 8. 容量估算

- Permissions 表：30-50 rows · 靜態
- Roles 表：4 built-in + 每 tenant 3-5 custom · 100 tenants → 500 rows
- role_permissions：每 role 10-30 perms · 500 × 20 → 10000 rows · 忽略
- Cache RAM：每 role 一個 Set · 500 × 30 perm ≈ 15KB · 忽略
- Permission check latency：cache hit < 1ms · miss < 10ms

---

## 9. 失效場景反思（FMEA）

| # | 場景 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|
| 1 | Permission migration 種子跑一半 · role 有但 role_permissions 沒 | 使用者變無權限 · 全部 403 | **P0** | ✅ Migration 一整體 transaction · idempotent · re-run 補 |
| 2 | Frontend cache 過期沒 refresh · UI 顯示錯的按鈕 | 使用者點下去 403 · 有點窘 | P2 | ✅ 5 min TTL · 點失敗 toast 提示重登入 |
| 3 | 攻擊者拿舊 JWT · 該 user 剛被 revoke role | 短時間內仍可用舊 permission | **P1** | ✅ 關鍵操作即時查 DB · JWT 8h 過期強制重登 |
| 4 | Tenant admin 自建 role 給下屬超權（bug 忘擋） | Escalation of privilege | **P0** | ✅ Backend 強制 subset check |
| 5 | Built-in role permissions 被改 · 全平台混亂 | 大災難 | **P0** | ✅ is_system=true 擋 API 更新 · 只 SQL owner 可改 |
| 6 | Permission cache 洩漏（如 log 印出）· 攻擊者摸到系統整組 permission map | Info leak · 便於針對性攻擊 | P2 | ⚠️ 殘留 · log 只印 permission_id 不印 set |
| 7 | Custom role 名字撞 built-in（如「aiproot_admin」）· 混淆 | UI 混亂 · 可能繞過 | P1 | ✅ UNIQUE constraint · Zod validation 擋保留字 |
| 8 | 兩 tenant admin 同時改同一 role · race condition | 一個成功一個蓋 | P2 | ✅ optimistic lock 或最後寫者勝（可接受） |
| 9 | Permission check cache 沒 invalidate · role 已改但仍舊生效 | 短暫錯覺 | P2 | ✅ 明確 invalidate on update · 5min TTL 兜底 |
| 10 | User.role_id 是 tenant A 的 role · 但 user.tenant_id 是 tenant B | 跨租戶越權 | **P0** | ✅ 指派時檢查 role.tenant_id = user.tenant_id or built-in |
| 11 | 沒 permission 對應的 endpoint（漏加 @RequirePermission） | 任何 authenticated user 都能打 | **P0** | ✅ Default-deny fallback：missing decorator → 401 · CI 檢查 |
| 12 | Permission migration 上 prod 但 code 沒 deploy · @RequirePermission 對不到 | 全 403 | **P0** | ✅ Order：code deploy → migrate → verify · 每步驗證 |

**P0 6 條**：#1 · #4 · #5 · #10 · #11 · #12 · 上 prod 前全緩解。

---

## 10. 觀測

- **Log**：permission check · struct log `{userId, resource, action, granted, cacheHit}`
- **Metric**：per-permission daily grant/deny count · 找無人用的 permission 可 cleanup
- **Alert**：same user 5 分鐘內 20+ permission_denied · 疑似探測攻擊
- **Dashboard**：Aiproot 側可看每 tenant 的 role 分佈 · custom role 使用率

---

## 11. 成本

- DB storage：忽略
- Cache RAM：忽略
- CPU：permission check < 1ms · 忽略
- 開發：Phase 1 (M1-M4) 約 5 天 · Phase 2 (custom role UI) 另 3-5 天

---

## 12. 兼容 · 遷移

- **既有 @Roles**：Phase 1 內部 delegate 到 @RequirePermission · 對外 API 不變
- **既有 `users.role`**：保留 · 新讀 role_id · fallback role 字串
- **既有 前端 role check**：Phase 1 保留 · 標記 deprecated · 逐步遷 `<PermGate>`
- **既有 tenants / users / audit_log**：不動 schema
- **既有 line-ingest / notify / warroom**：Controller 改 @RequirePermission · Service 邏輯不動

---

## 13. Open Questions（待用戶裁定）

### 資料模型

| # | 題目 | 建議 |
|---|---|---|
| OQ-PE-1 | Permission ID 格式（`resource:action` vs 純 UUID）| **`resource:action`** 字串 · 可讀 · debug 快 · trade-off：改 permission 名要 migration |
| OQ-PE-2 | Role 是否允許 tenant 自訂 vs 只 aiproot 建 | Phase 1：**只 built-in 4 個** · Phase 2：aiproot 可幫 tenant 建 custom · Phase 3：tenant 自服務 |
| OQ-PE-3 | User 一 role vs 多 role | Phase 1：**一 user 一 role** · Phase 2：secondary role list（如「同時是 group_owner 和顧問」）|
| OQ-PE-4 | Permission scope 分幾層 | `platform` (全) · `tenant` (own) · `department` (own dept) · **3 層夠** · 未來加 `project` 或 `record` |

### 系統行為

| # | 題目 | 建議 |
|---|---|---|
| OQ-PE-5 | Cache TTL | **5 分鐘** · balance |
| OQ-PE-6 | Cache invalidation timing | 改 role/permission 時**即時 broadcast**（若多 backend instance · Level 3 需 pub/sub · Phase 1 單 instance 直接清 memory 就好） |
| OQ-PE-7 | Missing @RequirePermission 時預設行為 | **Default-deny · 401** · 加 CI 檢查沒 decorator 的 endpoint |
| OQ-PE-8 | Custom role 命名保留字 | 禁 `aiproot_*` · `system_*` · `admin` · Zod regex 擋 |

### 前端 / UX

| # | 題目 | 建議 |
|---|---|---|
| OQ-PE-9 | `<PermGate>` fallback（無權時顯示啥）| **完全 hide** · 選 `<PermGate perm="X" fallback={...}>` 手動指定 |
| OQ-PE-10 | 使用者 hover 無權按鈕看到「你沒權限」提示 vs 完全隱藏 | Phase 1：**完全隱藏** · Phase 2：aiproot 可切「show disabled with tooltip」 |
| OQ-PE-11 | 前端 permission cache · 存哪 · 過期怎辦 | Context + localStorage · 5 min TTL · re-fetch on stale |

### 政策 / 執行

| # | 題目 | 建議 |
|---|---|---|
| OQ-PE-12 | 現有 @Roles 遷移策略 | Phase 1：內部 delegate · 不強迫改 · Phase 2 M4：全遷完 drop @Roles |

---

## 14. M1–M4 拆解

| 里程 | 內容 | 估算 | 完成準則 |
|---|---|---|---|
| **M1 · Backend permission engine** | Migration 0010 · PermissionService · @RequirePermission decorator · 4 built-in role 種子 · 內部 @Roles delegate | 1.5 天 | 單元測試 · curl 驗證：aiproot_admin can · tenant_admin can't · 快取命中 |
| **M2 · Backend endpoint 遷移** | 全 controller `@Roles` 逐步改 `@RequirePermission` · GET /me/permissions · GET /permissions · GET /roles | 1 天 | 全 endpoint 遷完 · 舊 @Roles guard 仍工作（雙保險） |
| **M3 · Frontend PermGate + 全遷** | `<PermGate>` helper · usePermissions hook · Shell.tsx · App.tsx · 各頁面 canEdit 全遷 | 1.5 天 | 手測 4 個 role 登入 · UI 該顯該藏都對 |
| **M4 · Docs + 上 prod** | permission-engine.md 標 APPROVED · CI 加「missing @RequirePermission」lint · MODULES.md 標 ✅ · prod migration + smoke | 0.5 天 | Prod 上完 · 4 role 皆正常 |

**總估算**：**4.5 天**

Phase 2（可選 · 未來需求）：custom role UI · secondary role · UI 「權限管理」頁 · 另 3-5 天。

---

## 15. Cross-cutting checks

- ✅ **Security**：default-deny · escalation 擋 · system role 保護 · cache 不 leak · audit 全記
- ✅ **Observability**：per-permission metric · deny 高頻 alert
- ✅ **Cost**：忽略
- ✅ **Compat**：@Roles 保留 backward compat · schema 加不減

---

## 16. Pre-mortem（rule_pre_mortem_user_triggered_paths · 3 題）

**Path**：Aiproot admin 新建 custom role（Phase 2）

1. **5× concurrent** — 5 admin 同時建同名 role
   - 影響：一 succeed 4 fail unique constraint
   - 緩解：正常 · UI toast 提示

2. **Abuse** — Aiproot admin 建 1000 個空 role 佔位
   - 影響：DB 髒 · 但 permission engine 不慢
   - 緩解：per-tenant 限制 50 個 custom role

3. **Race condition** — 建 role + 立刻指派 permission · permission 加了 role 沒建完
   - 影響：orphan permission
   - 緩解：Transaction · 或 permission 加時檢查 role exists

**Path**：User 拿 permission cache 打 endpoint · role 剛被 revoke

1. **5× concurrent** — 5 request 同時進 · cache 剛過期
   - 影響：全部去 DB 查 · thundering herd
   - 緩解：single-flight lock（若同 user 同 request 進來 · 只查一次）

2. **Abuse** — 攻擊者拿舊 JWT · 該 user 剛被 revoke
   - 影響：JWT 8h 內舊 permission 仍生效
   - 緩解：關鍵操作 backend 即時查 DB · 或加「revoked token blacklist」（Phase 3）

3. **Race condition** — permission 剛被移除 · cache 剛 refresh · 但 refresh 完 cache 覆蓋新 revoke
   - 影響：短暫錯誤 accept
   - 緩解：cache invalidate 用 optimistic locking（timestamp compare）· 5 min tolerance

---

## 附錄 · 引用文件與 memory

- `docs/modules/tenant-provisioning.md` — 姊妹模組 · 一起是 IAM 三隻腳
- memory `feedback_only_aiproot_creates_tenant_accounts.md` — 帳號建立權限
- memory `rule_fmea_before_ship.md` · `rule_pre_mortem_user_triggered_paths.md` · `rule_cross_cutting_checks.md`
- CLAUDE.md R2（安全敏感 test 覆蓋 > 80%）· R17（P0 上 prod gate）

---

## 附錄 · IAM 三隻腳全景

| 模組 | 負責 | 狀態 |
|---|---|---|
| **tenant-provisioning** | 開通新客戶 · 首個 admin · 預塞 defaults | M0 DRAFT |
| **auth (password policy)** | 密碼複雜度 · 過期 · 首次改 · 鎖定 · 已在 tenant-provisioning §7 內 | 併入 tenant-provisioning M0 |
| **permission-engine (本模組)** | RBAC · role · permission · gate | M0 DRAFT |

三個一起 completed 後 · aiproot 可以：
1. 精靈開新客戶 · 一鍵完成
2. 帳號安全 baseline 落地 · 密碼 policy / 首次改 / 鎖定
3. Fine-grained permission · 未來 tenant 自訂 role
4. **完成後可對外宣稱「商用等級 IAM」**
