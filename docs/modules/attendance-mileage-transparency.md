# 外勤里程可信度／透明化 設計（attendance-mileage-transparency）

> 目的：消解員工對里程的兩種不信任 —— **黑箱**（數字算得對不對）與**記少了**（是不是漏記段數）。
> 手段：把「數字怎麼來的」攤開給員工自己核對＝**地圖依據 + 打卡時間軸 + 方法透明 + 申訴出口**。
>
> 對照 [attendance-location-mileage.md](attendance-location-mileage.md)（M1/M2 已上 prod）。本文＝該模組的可信度增補（M3+）。
> 狀態（2026-07-25）：**M1+M2 本地 SHIPPED**（地圖折線 + 打卡時間軸/段數自明 + 每段方法依據）· **M3 申訴延後**（用戶裁定先暫存、表已建閒置）· 待 push + prod 跑 migration 0025。OQ-MT-1..6 全裁定（§7）。

---

## 1. 問題與目標

**現況**：「我的行程」只列「第 N 段 · 目的地 · 到點時間 · X km · 當日合計」＝純文字數字，無可核對的依據。

**兩種爭議**：
- **(a) 黑箱**：里程怎麼算的？走哪條路？是不是少算？
- **(b) 記少了**：我今天跑了 4 個點，怎麼只有 2 段？系統是不是漏記？

**目標**：
1. 每個里程數字都有**看得到的依據**（員工自己就能核對，不用問業助）。
2. **段數自明**：漏段一眼看出「不是系統漏、是我少打卡」。
3. 覺得不對時**有出口**（申訴），把沉默的不信任變成主管可處理的紀錄。

**不做的事**：不做里程費率/金額（承 attendance 模組裁定）；不自動核銷；不回溯重算歷史里程（R11 原始不可變）。

---

## 2. 三層依據（核心設計）

### 2.1 空間依據 —— 地圖
- 「我的行程」頂部放一張當日地圖：**打卡圖釘**（出發／各到點，含時間 + 員工填的地點名）＋**逐段路線折線**。
- 距離＝地圖上這條折線的長度 → 眼見為憑，黑箱感消失。
- 點某一段 → 地圖高亮該段 + 兩端圖釘。
- 技術：Leaflet + 圖磚（來源見 OQ-MT-1）；路線折線來自 provider 回傳的 route geometry（polyline，見 OQ-MT-2）。

### 2.2 來源依據 —— 打卡時間軸 + 段數自明
- 列出當日**打卡序列**：`出發 08:30 → 到點 示範案場A 10:15 → 到點 示範客戶B 14:00`。
- 明標「**共 3 個打卡點 ＝ 2 段里程**」。
- 這招專治「記少了」：段數少＝打卡少，員工自證（系統只能記你打過的卡）。

### 2.3 方法依據 + 申訴出口
- 每段可展開看一句方法說明：「依你的出發／到點打卡、走實際道路路線計算（provider: openrouteservice）」。
- 「**里程有誤？回報**」按鈕 → 建 dispute → 主管於戰情室複核（見 §5.2）。

---

## 3. 資料模型變更（R1 遷移計畫 · Migration 0025）

**新增欄位（ALTER · ADD COLUMN IF NOT EXISTS · 不破壞既有資料）**
- `attendance_trip.route_geometry text`：provider 回傳的 encoded polyline（道路路線）。null＝未記錄（含 M1/M2 舊資料）。
- `attendance_trip.straight_distance_m integer`：haversine 直線距離（已有純函式），供對照/備援（道路 vs 直線落差過大＝可疑訊號）。

**新增欄位（attendance_punch）**
- `address text`：反向地理編碼結果（惰性補，見 OQ-MT-3）。null＝尚未反查。
- `geocoded_at timestamptz`。

**新表 `attendance_mileage_dispute`**
| 欄位 | 說明 |
|---|---|
| dispute_id uuid PK | |
| tenant_id, user_id | RLS/歸屬 |
| trip_id uuid null | 針對某段；null＝整日申訴 |
| report_date date | 申訴的行程日 |
| reason text | 員工描述 |
| status text | `pending`/`reviewing`/`resolved`/`rejected` |
| created_at | |
| reviewed_by, reviewed_at, resolution text | 主管處理 |
- RLS：tenant 隔離（比照 attendance_trip）；WITH CHECK 同。
- 每（user, report_date, trip_id）僅一筆 `pending`（防洗版，見 FMEA）。

**map_routing_config（tile 設定前端化 · §4-bis）**
- 加 `tile_provider text default 'osm'`、`tile_api_key_enc bytea null`（pgcrypto 加密 · 比照 routing key）。

**回溯**：M1/M2 已產生、無 `route_geometry` 的 trip **不回溯重算**（R11）；該段地圖只畫兩端圖釘 + 直線並標「路線未記錄」。

---

## 4. API 變更

**打卡流程（attendance.service.punch）**
- 到點算里程時：除 `distance_m` 另存 `route_geometry`（provider polyline）＋ `straight_distance_m`（haversine）。
- provider interface 擴充：`computeRoute(from,to)` 回 `{ distanceM, polyline }`（現為只回距離）。Google Routes fieldMask 加 `routes.polyline.encodedPolyline`；ORS directions 回 geometry。

**GET /attendance/trips?date=（擴充回傳）**
- 每段加：`fromLat/fromLng/toLat/toLng`、`fromTime/toTime`、`routeGeometry`、`fromAddress/toAddress`、`straightDistanceM`、`provider`。
- 另回**當日所有 punch**（`punches: [{type, time, customerName, address, lat, lng}]`）供時間軸 + 段數自明。

**反向地理編碼**：punch.address 為空且有座標 → 走設定的 provider geocode 補（節流；即時 vs 背景見 OQ-MT-3）。

**申訴**
- `POST /attendance/mileage-dispute { reportDate, tripId?, reason }` → 建 dispute + audit log（R5）；擋重複 pending。
- 主管：`GET /attendance/mileage-dispute`（自租戶）、`POST .../{id}/resolve`。

---

## 5. 前端

### 5.1 員工「我的行程」升級（平台 Shell + LIFF 共用 MyTrips）✅ M2 已落地
- 頂部**當日地圖**（react-leaflet + CARTO light · 對齊 `kb/CustomerMap` 慣例）：圖釘（出發 teal／到點 indigo）+ 逐段折線（route_geometry 解碼；無則直線虛線標「路線未記錄」）。
- **時間軸**：打卡序列 + 「共 N 打卡點 · M 段里程（少一段通常是漏打了一次卡）」。
- 每段可展開：出發/到點地址 + 道路 vs 直線距離 + 方法說明 + provider。
- 地圖以 `React.lazy` 動態載入（Leaflet 獨立 chunk ~44KB gz · 不灌主 bundle）。
- 〔M3 延後〕「回報有誤」按鈕暫未加。

### 5.2 主管「里程申訴」複核（戰情室）· 🔒 M3 延後（2026-07-25 用戶裁定先暫存）
- 新頁：列自租戶 pending 申訴（員工/日期/段/理由）→ 標記處理（resolved/rejected + 說明）。
- 側欄紅點提示未處理（見 OQ-MT-4）。
- `attendance_mileage_dispute` 表已於 0025 建好、目前閒置；有需求再接。

---

## 6. 失效場景反思（FMEA · R17）

| 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|
| **部署順序** | 0025 未先跑就部署 M1 code | `insertTrip` 寫不存在欄位 → **到點打卡 500** | **P0** | push 時**先在 prod 跑 0025、再讓 Render 部署**；本地已驗欄位齊 ✅（🔒 靠人工照順序） |
| 圖磚 provider | 當機/限流 | 地圖空白 | P2 | 數字仍在；地圖降級不擋頁 ✅ |
| 舊 trip 無 polyline | M1/M2 前資料無幾何 | 地圖畫不出路線 | P2 | 只畫兩端+直線虛線+標「路線未記錄」；不回溯（R11）✅ |
| 反向地理編碼 | 失敗/限流 | address 空 | P2 | 顯員工填的地點名 + 座標；address 為加分非必需 ✅ |
| 位置 address | 住址等敏感 PII | 隱私外洩 | **P1** | 僅本人（JWT user_id 限定自己）；主管視圖屬 M3、延後；aiproot 平台端預設不看座標明細 ✅ |
| CARTO/OSM 圖磚 | product 量級直連違反公平使用政策 | 被封/服務中斷 | P2 | 預設 CARTO light（OSM 資料·較寬鬆）+ attribution；量大換 MapTiler（前端可設）🔒 政策 gate |
| 申訴洗版 | 主管被灌爆 | — | — | 〔M3 延後〕表已加唯一鍵 uq_mileage_dispute_pending（每 user/date/trip 限一 pending）備用 |

> **P0 部署順序**是本次唯一必守的上線 gate（0025 先於 code）。位置 PII 因 M2 僅「員工看自己」而收斂為可控；主管視圖到 M3 再處理層級。

---

## 7. 開放問題（OQ-MT-N）— 全數裁定 2026-07-24（用戶「全採建議」＋「配置一律前端」）

- ~~OQ-MT-1 圖磚來源~~ → **已裁定**：pilot 免金鑰 + attribution，量大再換含金鑰的 tile provider（如 MapTiler）。**實作微調**：預設底圖用 **CARTO light**（OSM 資料、較乾淨、與既有「客戶地圖」一致），非 raw OSM 圖磚；MapTiler 為前端可設的升級選項。**tile provider + 金鑰一律走 aiproot 前端設定（見 §4-bis），不走 env**。
- ~~OQ-MT-2 路線幾何~~ → **已裁定**：**存 provider 道路 polyline**（消黑箱關鍵）。
- ~~OQ-MT-3 反向地理編碼時機~~ → **已裁定**：**打卡後背景補**；前端先顯員工填的地點名，address 補上後才顯。反查沿用已設的 routing provider（ORS Pelias `/geocode/reverse` 或 Google geocoding），**無新金鑰**。
- ~~OQ-MT-4 申訴通知~~ → **已裁定**：**只進戰情室清單 + 側欄紅點**，不主動推 LINE（省 push 計費）。
- ~~OQ-MT-5 位置 PII 可見層級~~ → **已裁定**：address/座標**僅本人 + 該租戶主管**可見（RLS + audit）；aiproot 平台端預設不看座標明細（只看聚合/里程）。精度保留完整（供主管核對），但顯示層以 role 收斂。
- ~~OQ-MT-6 舊資料~~ → **已裁定**：**不回溯**（R11 不改歷史），只新資料有折線。

## 4-bis. 配置原則 · 一律前端操作（用戶鐵則 2026-07-24）

> 本模組任何可配置項一律在 **aiproot 前端**操作、加密存 DB，不走 env/CLI/手動 SQL（延續 [[feedback_tenant_self_governance]] 與地圖 key 前端化的既有 pattern）。

- **擴充現有「地圖里程設定」頁**（`aiproot-console/MapConfig` + `/aiproot-console/map-config`）：
  - 既有：routing provider（ORS/Google）+ routing key。
  - 新增：**tile provider**（osm / maptiler / …）+ **tile 金鑰**（加密存 `map_routing_config`，比照 routing key 的 pgcrypto 欄位）。
  - 反查沿用 routing provider，不另設欄位。
- migration 0025 於 `map_routing_config` 加 `tile_provider`、`tile_api_key_enc`（nullable；osm 無需金鑰）。

---

## 8. 里程碑

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M1** | schema 0025（trip geometry/straight + punch address + dispute 表 + tile 欄位）+ 打卡流程存 polyline/straight + provider `computeRoute`/`reverseGeocode` + geocode 背景補 | ✅ 本地 SHIPPED（ec62837）|
| **M2** | GET trips 擴充（幾何/端點/address/punches）+ MyTrips 升級（react-leaflet 地圖 + 時間軸 + 段數自明 + 方法展開）+ aiproot tile 設定 | ✅ 本地 SHIPPED（8c984ae/9ef5ac7）|
| **M3** | 申訴端到端：員工回報 + 主管戰情室複核頁 + 側欄紅點 | 🔒 延後（2026-07-25 用戶裁定 · 表已建閒置）|
| **M4** | docs 收尾 + FMEA 補全（+P0 部署順序）+ MODULES.md 標狀態 | ✅ 本文 |

> 待辦（push 時）：**先跑 prod migration 0025 再部署**（P0）· 之後 push 8+ commits · 地圖 key 非必需（預設 CARTO light 免金鑰）。

---

## 附錄 · 技術來源
- Leaflet（輕量地圖、free）· OpenStreetMap 圖磚使用政策（attribution + 公平使用）
- Google Routes `computeRoutes` polyline（fieldMask `routes.polyline`）· OpenRouteService directions geometry + `/geocode/reverse`（Pelias，同金鑰）
- 承 [attendance-location-mileage.md](attendance-location-mileage.md) provider 可插拔設計（§3.3）
