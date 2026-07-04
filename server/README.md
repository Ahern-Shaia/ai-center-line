# server — Phase 1 後端（M1 地基）

Phase 1 一條龍 live loop 的後端服務。CLI 分析原型仍在專案根 `src/`（本服務於 M2 起重用其抽取邏輯）。
設計依據：`docs/modules/phase1-live-loop.md`（APPROVED）＋ `docs/台灣福祉_系統設計文件_開發用.md`。

## 現況（M1 進行中）
- ✅ 資料地基：`docker-compose.yml`（PG16+Redis）、Drizzle schema、`0001_init.sql`（表＋RLS＋最小權限角色 `app_rw`）、`withTenant()` 租戶隔離 transaction。
- 🔨 下一步：NestJS HTTP 層（JWT／RBAC guard／租戶 interceptor／`/auth/login`）＋ RLS 隔離測試。

## Dev 起步
```bash
# 1) 起 DB / Redis（於專案根）
docker compose up -d

# 2) 安裝與環境
cd server
cp .env.example .env
npm install

# 3) 套用 migration（dev：以 postgres 擁有者連線建表＋RLS＋app_rw 角色）
npm run migrate

# 4) 型別檢查
npm run typecheck
```

## 租戶隔離怎麼運作
- 應用連線用 **`app_rw`**（最小權限、**非 superuser／非 owner** → 受 RLS 約束）；見 `.env` 的 `DATABASE_URL`。
- 每個請求包一個 transaction，`withTenant(ctx, fn)` 內 `SET LOCAL app.current_tenant/role/department`；RLS policy 以此判斷可見列。
- `FORCE ROW LEVEL SECURITY`：連 owner 連線也受約束，避免工具/測試用 owner 時繞過。

## prod 注意（R10）
- migration **由人工執行 SQL**（`src/db/migrations/0001_init.sql`），不要用 `npm run migrate` 對 prod 自動跑。
- `app_rw` 密碼、`JWT_SECRET` 走 secret 管理，勿硬編。
