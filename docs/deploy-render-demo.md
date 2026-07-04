# Render 部署 SOP · demo 錄影階段

> 對象：把當前 demo 部署到 Render 供錄影 / 廠商展示用
> 撰寫日期：2026-07-05
> 狀態：**demo 階段簡化版**（不含 prod 硬化 · Redis / Outbox / observability 等延後）

---

## 0. 現況與已知限制

| 項 | 現況 | Render 相容 |
|---|---|---|
| Backend | NestJS + Fastify + PG16 + RLS + Drizzle · 節點 24 | ✅ 可跑 |
| 監聽 | `0.0.0.0:PORT` env driven | ✅ |
| DB migration | `0001_init.sql` 有 `CREATE ROLE app_rw` + GRANT | ⚠ **需調整**（Render PG 一般用戶無 CREATEROLE 權限） |
| CORS | ❌ 未啟用（前後端同源 dev） | ⚠ **需調整**（跨域必開） |
| 前端 | Vite build 產靜態 dist/ · dev proxy `/api/*` | ⚠ **需調整**（prod 走 `_redirects` 或 env-based URL） |
| Redis | 本機有 dev · outbox worker 尚未實作 | 🔭 delayed（demo 不需要） |
| Migration RLS FORCE | 靠 owner 也受 FORCE 約束 | ✅ Render PG owner 可以 |

---

## 1. Pre-flight · 3 個 code 調整（demo 階段最少可用）

### 1.1 CORS 啟用（`server/src/main.ts`）

```typescript
const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
await app.register(await import('@fastify/cors').then(m => m.default), {
  origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
  credentials: false,
});
```

依賴：`npm i @fastify/cors`（server/）

### 1.2 Migration 相容 Render（`server/src/db/migrations/0001_init.sql`）

把 `CREATE ROLE app_rw` + GRANT 段包進 DO block，Render 沒 CREATEROLE 權限時跳過：

```sql
-- app_rw 分離角色（僅 dev 用；Render 沒 CREATEROLE 權限時直接跳過，改用 owner 承擔）
DO $$
BEGIN
  CREATE ROLE app_rw LOGIN PASSWORD 'app_rw_pw';
EXCEPTION
  WHEN insufficient_privilege THEN RAISE NOTICE 'skip CREATE ROLE app_rw (insufficient_privilege · using owner)';
  WHEN duplicate_object THEN RAISE NOTICE 'app_rw 已存在，略過';
END $$;

DO $$
BEGIN
  GRANT USAGE ON SCHEMA public TO app_rw;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
EXCEPTION
  WHEN undefined_object THEN RAISE NOTICE 'app_rw 不存在（Render 環境），略過 GRANT';
END $$;
```

Backend 用 `DATABASE_URL`（owner）連線；`FORCE RLS` 對 owner 生效，安全性不受影響。

### 1.3 Frontend `/api/*` 代理（`web/public/_redirects`）

Render Static Site 讀 `_redirects` 檔做 rewrite / redirect：

```
/api/*  https://<你的-backend-service>.onrender.com/:splat  200
/*      /index.html                                          200
```

**注意**：`<你的-backend-service>` 要在 Render 建 backend 後才知道，先建 backend、拿到 URL 再回來填。

---

## 2. Render 設定順序（3 個 service）

### 2.1 PostgreSQL Managed

Render Dashboard → **New** → **PostgreSQL**
- Name: `ai-center-line-db`
- Region: **Singapore**（最靠近台灣）
- Plan: **Free** 90 天足夠 demo 週期（正式再升）
- Version: 16
- 建好後 copy **Internal Connection String** → 用來給後端連（免公網流量費）

### 2.2 Backend · Web Service

Render Dashboard → **New** → **Web Service** → 連 GitHub repo
- Repository: `ai-center-line`
- Branch: `main`
- **Root Directory**: `server`
- Runtime: Node
- Build Command: `npm ci && npm run build`
- Start Command: `npm start`
- Region: Singapore
- Plan: **Starter**（Free 有冷啟延遲 30s · demo 影響體驗）

**Environment 環境變數**：

| Key | Value |
|---|---|
| `NODE_VERSION` | `24` |
| `DATABASE_URL` | 從 2.1 PG 帶出（Internal Connection String） |
| `MIGRATION_DATABASE_URL` | 同上 |
| `JWT_SECRET` | 用 `openssl rand -hex 32` 產生 64 字元隨機值 |
| `CORS_ORIGINS` | `https://<前端-service>.onrender.com`（暫時填 `*` 之後改） |

按 Create → 等第一次 build（第一次會失敗因為 DB 沒 migrate；不理它）

### 2.3 Frontend · Static Site

Render Dashboard → **New** → **Static Site** → 同一 repo
- Branch: `main`
- **Root Directory**: `web`
- Build Command: `npm ci && npm run build`
- Publish Directory: `dist`
- Region: Singapore

**Redirects/Rewrites**（Render 會讀 `web/public/_redirects` 若有；也可在 UI 加）：
- `/api/*` → backend URL + `/:splat` (Status 200 rewrite)
- `/*` → `/index.html` (Status 200 SPA fallback)

按 Create → build 完成後拿到 URL

### 2.4 補完環境變數

- 回 Backend service 的 Environment → 把 `CORS_ORIGINS` 改成前端實際 URL（`https://aiproot-warroom.onrender.com` 之類）
- Save → 觸發 redeploy

---

## 3. 首次 migration + seed（Render backend Shell）

Render backend service → 頂部 Tabs → **Shell**（Starter plan 才有；Free 沒有 Shell 得用 One-off Job）

```bash
npm run migrate    # 應該印 → apply 0001_init.sql ... ok / 0002_users_display_name.sql ... ok
npm run seed:demo  # 應該印 demo seed 完成：租戶「aiproot」· 6 部門 · 13 tickets
```

驗證：
```bash
curl https://<backend-service>.onrender.com/health
# 預期：{"status":"ok"}

curl -X POST https://<backend-service>.onrender.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"gm@taiwanhomecare.demo","password":"demo123"}'
# 預期：{"access_token":"eyJ..."}
```

---

## 4. Smoke test（開瀏覽器）

1. 開 `https://<frontend-service>.onrender.com/`（不要用 `#demo` 讓客戶看到手動登入流程）
2. 用 `gm@taiwanhomecare.demo` / `demo123` 登入
3. 走過 9 個 module：
   - 總覽儀表 → 三張 gauge 應該 33% / 67% / 62%
   - 每日簽核 → 售後服務自動展開（低信心攔截）
   - 智慧檢索 → 5 個建議問題 · 點 Q1 走 typewriter · 右側源浮現
   - 素材看板 → 16 張卡分 5 filter
   - 知識庫 → 12 張 KM · 搜「消防」/「升降機」
   - 客戶地圖 → **Leaflet 底圖首次載入約 2-3 秒**（tile 從 CartoDB CDN 拉）· 14 個 marker
   - 部門/成員 → 6 部門 table + 30 位成員
   - 租戶設定 → 5 section
   - 稽核記錄 → 26 筆 · filter 可用
4. 右上頭像 → 登出 → 回登入頁

---

## 5. 錄影提示

**冷啟避雷**（Starter plan 15 分鐘無流量會 spin down，第一 request 冷啟約 5-10s）：
- 開錄影前 5 分鐘先開一次前端頁面暖機
- 或用 UptimeRobot free tier 每 5 分鐘 ping `/health` 保持熱

**Leaflet tile 快取**：
- 客戶地圖首次進入會拉 tile · 之後有 browser cache
- 建議錄影前先進「客戶地圖」暖 tile · 再回總覽開始錄

**demo 帳號別秀 hint**：
- Login 頁 demo hint 已在 code 拿掉 · 錄影時直接手動輸入即可

**URL 別露 `.onrender.com`**：
- 錄影時把瀏覽器網址列裁掉
- 或申請 Custom Domain（Render Starter 支援 · 台灣福祉可用 `warroom.aiproot.com` 之類）

---

## 6. 故障排查

| 症狀 | 可能原因 | 解 |
|---|---|---|
| 登入 500 | DB migration 沒跑 | Render Shell → `npm run migrate` |
| 登入 401「帳號或密碼錯誤」但你打對 | seed 沒跑 | `npm run seed:demo` |
| 前端 fetch `/api/*` 404 | `_redirects` 沒生效或 URL 拼錯 | 檢查 `web/public/_redirects` |
| 前端 fetch CORS block | 後端 CORS_ORIGINS 沒設或錯 | 改後端環境變數 → 觸發 redeploy |
| 儀表 500 | RLS policy 阻擋（無 tenant context）| 檢查 backend log · 通常是漏 `withTenant()` |
| Leaflet tile 全灰 | CartoDB CDN 網路阻擋 | 檢查 CSP 或改用 OpenStreetMap 原生 tile |
| 首次進頁 30s 白屏 | Free plan 冷啟 | 升級 Starter |

---

## 7. Rollback

Render 每個 deploy 有 revision。任何一個服務要退版：
1. Service → **Deploys** tab
2. 找上一個 successful revision
3. 按 **Rollback**（backend 秒退，static site 30 秒退）

Data 層退版：
1. Render PG 有 **Point-in-time recovery**（Starter 以上）
2. Free plan 每天備份一次 · Rollback via dashboard

---

## 8. 錄影後續（可選）

- Custom domain：`warroom.aiproot.com` A record → Render → 加 SSL（Render 自動 Let's Encrypt）
- **移除 `#demo` 自動登入** hash → App.tsx 那段可拿掉（正式版本應手動登入）
- 環境區隔：main branch → demo 站；後續 pilot 開 `staging` branch → staging 站

---

## Deferred（本 SOP 不覆蓋）

- ❌ Prod hardening（SSL headers · rate limit · WAF · DDoS · SOC 2）
- ❌ 監控（Sentry · DataDog · uptime）
- ❌ Redis（Outbox / lock）
- ❌ MinIO / S3（媒體檔物件儲存）
- ❌ 多環境 branch strategy
- ❌ CI/CD gates（tests must pass · migration dry-run）
- ❌ Blue-green / canary deploy

以上進 `phase1-live-loop.md` M2 / M3 · 客戶付費上線前必補。
