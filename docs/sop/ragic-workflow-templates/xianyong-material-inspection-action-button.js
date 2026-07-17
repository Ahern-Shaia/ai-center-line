// ============================================================
// Ragic Action Button · 鮮勇 原料驗貨單（上游-4a） → LINE 通知
// ============================================================
// Sheet：/erp/64（原料驗貨單 · 上游-4a）
// Ragic 帳號：freshfruits（ap16.ragic.com/freshfruits）
// 觸發：使用者按「發送 LINE 通知」按鈕（Action Button · JS Workflow）
//       Button 版本無條件 push（人工按下就是刻意要發）
// Backend：POST /notify/ragic/material-inspection
// 對應：docs/modules/notify-multi-tenant.md v0.1
//
// ⚠️ 貼用注意（Ragic Action Button 單行 input 限制）：
//    多行會被壓成空白、// 註解會殺後面 code。BEGIN...END 之間貼那整整一行
//
// 貼用步驟：
// 1. 進 Ragic freshfruits → 原料驗貨單 sheet → 修改設計 → 表單設定 → 動作按鈕 → 新增「發送 LINE 通知」
// 2. 動作類型：JS Workflow
// 3. 「動作」欄位貼 BEGIN...END 之間那一行
// 4. 把 GLOBAL_NOTIFY_SECRET 換成 backend .env 內 NOTIFY_WEBHOOK_SECRET_XIANYONG 實際值
// 5. 儲存按鈕 → 儲存表單設定
// ============================================================

/* ============ BEGIN ACTION BUTTON PAYLOAD (單行、無 // 註解) ============ */

var BACKEND_URL = "https://ai-center-line.onrender.com"; var GLOBAL_NOTIFY_SECRET = "<REPLACE_WITH_NOTIFY_WEBHOOK_SECRET_XIANYONG_FROM_ENV>"; var RAGIC_ACCOUNT_URL = "https://ap16.ragic.com/freshfruits"; var SHEET_PATH = "/erp/64"; var SHEET_NAME = "鮮勇原料驗貨單"; var rid = __actionButtonExecuteNodeId; var query = db.getAPIQuery(SHEET_PATH); var entry = query.getAPIEntry(rid); var payload = { trigger: "button", sheetPath: SHEET_PATH, sheetName: SHEET_NAME, recordUrl: RAGIC_ACCOUNT_URL + SHEET_PATH + "/" + rid, timestamp: new Date().getTime(), recordId: parseInt(rid, 10) || 0, record: { "品項名稱": entry.getFieldValue(1018491), "品編": entry.getFieldValue(1018574), "批號": entry.getFieldValue(1018604), "收貨數量": entry.getFieldValue(1018494), "數量": entry.getFieldValue(1018572), "單位": entry.getFieldValue(1018495), "製造有效日期": entry.getFieldValue(1018597), "檢驗完成": entry.getFieldValue(1023030) } }; util.setHeader("Content-Type", "application/json"); util.setHeader("X-Notify-Secret", GLOBAL_NOTIFY_SECRET); try { var res = util.postURL(BACKEND_URL + "/notify/ragic/material-inspection", JSON.stringify(payload)); log.info("[notify] " + res); } catch (e) { log.error("[notify] failed: " + e); }

/* ============ END ACTION BUTTON PAYLOAD ============ */
