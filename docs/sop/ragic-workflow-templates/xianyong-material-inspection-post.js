// ============================================================
// Ragic Post Workflow · 鮮勇 原料驗貨單（上游-4a） → LINE 通知
// ============================================================
// Sheet：/erp/64（原料驗貨單 · 上游-4a）
// Ragic 帳號：freshfruits（ap16.ragic.com/freshfruits）
// 觸發：記錄儲存後無條件 push（OQ-NMT-9 修訂：任何修改都發，與報價單同策略）
// Backend：POST /notify/ragic/material-inspection
// 對應：docs/modules/notify-multi-tenant.md v1.0
//
// ⚠️ 一定要放在「該 sheet 的 Post-workflow」，不是 Global Workflow
//
// 貼用步驟：
// 1. 進 Ragic freshfruits 帳號 → 原料驗貨單 sheet → 修改設計 → JavaScript Workflow → 上方切「Post-workflow」
// 2. Cmd+A 清空編輯區
// 3. 貼此整份
// 4. 把 GLOBAL_NOTIFY_SECRET 換成 backend .env 內 NOTIFY_WEBHOOK_SECRET_XIANYONG 實際值
// 5. 儲存 workflow → 儲存修改設計
// ============================================================

var BACKEND_URL = "https://ai-center-line.onrender.com";
var GLOBAL_NOTIFY_SECRET = "<REPLACE_WITH_NOTIFY_WEBHOOK_SECRET_XIANYONG_FROM_ENV>";
var RAGIC_ACCOUNT_URL = "https://ap16.ragic.com/freshfruits";
var SHEET_PATH = "/erp/64";
var SHEET_NAME = "鮮勇原料驗貨單";

var entry = param.getUpdatedEntry();
var recordId = param.getRootNodeId();

var payload = {
  trigger: "save",
  sheetPath: SHEET_PATH,
  sheetName: SHEET_NAME,
  recordUrl: RAGIC_ACCOUNT_URL + SHEET_PATH + "/" + recordId,
  timestamp: new Date().getTime(),
  recordId: parseInt(recordId, 10) || 0,
  record: {
    品項名稱: entry.getFieldValue(1018491),
    品編: entry.getFieldValue(1018574),
    批號: entry.getFieldValue(1018604),
    收貨數量: entry.getFieldValue(1018494),
    數量: entry.getFieldValue(1018572),
    單位: entry.getFieldValue(1018495),
    製造有效日期: entry.getFieldValue(1018597),
    檢驗完成: entry.getFieldValue(1023030),
  },
};

util.setHeader("Content-Type", "application/json");
util.setHeader("X-Notify-Secret", GLOBAL_NOTIFY_SECRET);

try {
  // ⚠ 一行寫完 · Ragic Rhino ES5 引擎不支援函數呼叫參數列的尾逗號
  var res = util.postURL(BACKEND_URL + "/notify/ragic/material-inspection", JSON.stringify(payload));
  log.info("[notify] " + res);
} catch (e) {
  log.error("[notify] failed: " + e);
  // 刻意不 setStatus("ERROR")：LINE 失敗不擋使用者存檔（見 notify.md §7-bis.3）
}
