# 設計文件 · 外勤定位打卡 + A→B 里程（M0）

> 狀態：**M0 · 開放問題待用戶裁定**（CLAUDE.md R6）
> 對象：新模組 `server/src/attendance/*` + LIFF 打卡視圖（`web/src/liff/`）+ Ragic 出勤/里程表。
> 日期：2026-07-24 · 作者：ahern + Claude（含 4 份平行研究）

---

## 1. 需求
業務性質員工：在 **A 點打卡上班** → 移動到 **B 點（案場）開始執行工作** → 系統算 **A→B 開車最佳路線公里數**並記錄。

> **裁定（2026-07-24）**：**只算並記錄「A→B 距離」（按地圖路線）**。**不算里程費率、不算報銷金額**（費率/報銷不在本模組範圍）。單程 A→B，不含回程。

## 2. 建在什麼之上（既有可複用）
- **LIFF React app 已就緒**（本次收斂）：打卡視圖直接加一個 `?page=punch` route，複用 `liff-verify`（access token → 可信 userId）認證 —— **不需信任前端 lineUserId**。
- **媒體下載**（`media-download.service.ts`）：若打卡要求現場拍照，可複用即收即存 S3 pattern。
- **Ragic 寫入 pattern**（`scripts/ragic-api-import.ts`）：`POST {BASE}/{ACCOUNT}{sheetPath}?api`，URLEncoded form，Basic Auth（`RAGIC_API_KEY`）。
- **案場/人員主檔**在 Ragic（`masterData.ts` 有 persons/work_orders）—— geofence 的「已知案場座標」可由此來。
- **personal-daily-report 模組**是成熟的 LIFF + CRUD + 主管通知範本，本模組照抄結構。

## 3. 技術關鍵（研究結論）
### 3.1 定位取座標
- **LIFF 無 `liff.getLocation()`** → 用標準 `navigator.geolocation.getCurrentPosition(ok, err, { enableHighAccuracy:true, timeout:10000, maximumAge:0 })`。
- **HTTPS 必要**（我們已是）；須 **user gesture**（點「打卡」按鈕）觸發權限提示。
- **🔴 iOS 16.4+ LIFF webview 已知 bug**：定位 callback 可能不回、卡死 → **timeout + 重試提示是必做**，不是選配。
- **Fallback**：定位屢失敗 → 改用 LINE「傳送位置訊息」→ webhook 收 `latitude/longitude`（使用者手動分享）。
- **🔴 座標可偽造**（Fake GPS / DevTools）→ **前端座標零信任**。

### 3.2 A→B 里程計算
- **已有 A、B 兩組 GPS 座標 → 不需 geocoding**，直接丟路線 API 算開車距離。
- **首選 Google Routes API `computeRoutes`（DRIVE）**：回 `distanceMeters`（**實際道路距離非直線**）；`X-Goog-FieldMask` 只取距離控成本；**免費 10,000 次/月**（每次打卡=1 request，外勤量級通常實質 $0）。
- **為可稽核/可重現**：用 **`routingPreference: TRAFFIC_UNAWARE`**（不含即時路況）→ 同一 A→B 距離固定、可重算、可稽核。
- **備案**：OpenRouteService（免信用卡、全免費）；量大再評估 **OSRM 自架**（per-call $0，換運維）。
- **費率／報銷金額不算**（用戶裁定）→ 只存 `distance_m`（公里 = distance_m/1000）。

### 3.3 可插拔路線 provider（OQ-ATT-3 裁定：兩個都做 · 管理員前端選用）
後端定義 `RoutingProvider` 介面 `computeDistance(from, to) → { distanceMeters, provider }`，兩個實作：
- `GoogleRoutesProvider`：`computeRoutes`（DRIVE + `TRAFFIC_UNAWARE` + fieldMask 只取 `distanceMeters`）。
- `OpenRouteServiceProvider`：`directions/driving-car`（免信用卡、全免費）。

**選用由設定決定**（層級見 OQ-ATT-3b）；**前端設定頁比照「語言模型設定」**：管理員切 provider + 填該 provider 的 API key。`attendance_trip.route_source` 記實際用的 provider（可稽核）。
**好處**：Google 額度爆/停用可即時切 ORS、不綁死 vendor、不同租戶可用不同 provider。

## 4. 資料流（建議）
```
LIFF 打卡頁(?page=punch)
  上班打卡(A)：getLocation → POST /attendance/punch {accessToken, type:'clock_in', lat,lng,accuracy}
              後端 liff-verify → userId · 落 attendance_punch · geofence 檢查
  到點打卡(B、C…)：getLocation → POST /attendance/punch {..., type:'arrive_site'}
              後端：抓該員工「當日前一個打卡點」→ 算 前點→此點（Routes API TRAFFIC_UNAWARE）→ distance_m
              落一筆 attendance_trip（逐段各一趟）· 反作弊旗標（速度/時間/精度/mock）
  ⇒ 一天多站 = A→B、B→C … 每段各一筆 trip（distance_m 各自算）
落 DB → 戰情室檢視（打卡點 + 逐段距離）· （是否另同步 Ragic 之後再議 · 非本模組核心）
```

## 5. 資料模型（新增，待 OQ 定案）
- **`attendance_punch`**：punch_id, tenant_id, user_id, type(`clock_in`/`arrive_site`/`clock_out`), lat, lng, accuracy_m, address(nullable, 選配反查), punched_at, source(`liff_geo`/`location_msg`), photo_media_id(nullable), suspicious jsonb(旗標明細)。
- **`attendance_trip`**：trip_id, tenant_id, user_id, from_punch_id, to_punch_id, distance_m, route_source(`google_routes`/…), computed_at, confirm_status(`pending`/`confirmed`/`rejected`), ragic_sync_status。（不含費率/金額）
- RLS：比照 tickets（tenant_admin 自租戶、group_owner 自部門）。R5 audit log 寫入。

## 6. 反作弊（前端零信任 · 後端多層）
1. **geofence**：A 是否落在「已知打卡點/公司」半徑內；B 是否落在案場半徑內（案場座標來自 Ragic 主檔）。
2. **時間/速度合理性**：A→B 打卡時間差 vs 距離 → 反推速度，>150km/h 之類標可疑。
3. **精度過濾**：`accuracy_m` 過大（>100m）標低信心、要求重打或補拍照。
4. **選配現場拍照**：拉高造假成本（複用媒體下載）。
5. 可疑一律**標旗標交主管審**，不自動核銷。

## 7. 失效場景反思（FMEA · 上線前補全 R17）
- iOS 16.4 定位卡死 → timeout + fallback（location message / 補拍照）。**P1**
- Routes API 失敗/額度爆 → 距離延後算、可重試、備援 OpenRouteService。**P2**
- 座標偽造 → 後端 geofence/速度/旗標（前端擋不住）。**P1**
- GPS 飄移落錯路段 → 精度過濾 + 主管審。**P2**
- 單程 vs 來回定義錯 → 報銷金額爭議（見 OQ）。**P1**

## 8. 開放問題（OQ · 待裁定才進 M1）
- ~~OQ-ATT-1 里程口徑~~ · ~~OQ-ATT-2 費率~~ · ~~OQ-ATT-1b 多站~~ → **已裁定**：只算並記錄**單程距離**、不算費率/金額；**一天多站逐段各記一趟**（A→B 一趟、B→C 一趟…，每段各自算距離）。
- ~~OQ-ATT-3 地圖 API~~ → **已裁定**：**Google Routes + OpenRouteService 兩個都做**，做成**可插拔 provider**、**管理員在前端設定頁選用**（見 §3.3）。
- ~~OQ-ATT-3b 設定層級~~ → **已裁定：aiproot 全域設定**（比照語言模型設定 · provider + API key 屬平台層）。key 存放 secret/env（實作時定）。
- **OQ-ATT-4 案場座標來源**（部分裁定）：定位為**確認的客戶需求**；geofence 案場座標來源待客戶提供（推測 Ragic 案場/客戶表）。→ **MVP 先不做 geofence**（只記打卡點 + 距離 + 後端速度/精度檢查），拿到案場資料再加。
- ~~OQ-ATT-5 現場拍照~~ → **建議裁定（待點頭）**：**不每次強制拍照**；後端判定**可疑時才要求補拍**（智慧升級）+ **設定開關**（可切「一律拍照」）。
- ~~OQ-ATT-6 簽核 · OQ-ATT-7 Ragic 目標表~~ → **移至費用 doc（feature 2）**：用戶澄清「寫 Ragic + 確認」是費用拍照功能的需求，非本模組。**本模組里程資料先記 DB + 戰情室檢視**；是否另同步 Ragic 之後再議。
- ~~OQ-ATT-8 打卡類型~~ → **已裁定：上班打卡(A) + 多次到點打卡(B/C/D…)**；每次到點＝一趟（承 OQ-ATT-1b）。下班打卡選配。

## 附錄 · 來源
- [LIFF API reference（無 getLocation）](https://developers.line.biz/en/reference/liff/) · [LINE webhook location event](https://developers.line.biz/en/reference/messaging-api/#wh-location)
- [MDN Geolocation（enableHighAccuracy / HTTPS）](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition) · [LINE LIFF docs（iOS 16.4 定位雷）](https://developers.line.biz/en/docs/liff/developing-liff-apps/)
- [Google Routes computeRoutes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes) · [Routes fieldMask](https://developers.google.com/maps/documentation/routes/choose_fields) · [Maps API 計價 2026](https://mapatlas.eu/blog/google-maps-api-pricing-2026)
- [openrouteservice](https://openrouteservice.org/) · [OSRM](https://wiki.openstreetmap.org/wiki/Open_Source_Routing_Machine)
- [國內差旅費里程費率（臺大主計）](https://www.ntuacc.ntu.edu.tw/web/qa/qa.jsp?dmno=DM1514966314802)
