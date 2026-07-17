// ============================================================
// Ragic Post Workflow · 鮮勇 報價單（下游-1） → LINE 通知
// ============================================================
// Sheet：/erp/1（報價單 · 下游-1）
// Ragic 帳號：freshfruits（ap16.ragic.com/freshfruits）
// 觸發：記錄儲存後（Sheet 專屬 Post-workflow · textarea 多行編輯器）
// Backend：POST /notify/ragic/quotation
// 對應：docs/modules/notify-multi-tenant.md v0.1
//
// ⚠️ 一定要放在「該 sheet 的 Post-workflow」，不是 Global Workflow
//
// 貼用步驟：
// 1. 進 Ragic freshfruits 帳號 → 報價單 sheet → 修改設計 → JavaScript Workflow → 上方切「Post-workflow」
// 2. Cmd+A 清空編輯區
// 3. 貼此整份
// 4. 把 GLOBAL_NOTIFY_SECRET 換成 backend .env 內 NOTIFY_WEBHOOK_SECRET_XIANYONG 實際值
// 5. 儲存 workflow → 儲存修改設計
// 6. ⚠️ 登出 Ragic + 重新登入（否則 workflow 儲存了但不 fire、session cache 需 refresh）
// ============================================================

var BACKEND_URL = "https://ai-center-line.onrender.com";
var GLOBAL_NOTIFY_SECRET = "<REPLACE_WITH_NOTIFY_WEBHOOK_SECRET_XIANYONG_FROM_ENV>";
var RAGIC_ACCOUNT_URL = "https://ap16.ragic.com/freshfruits";
var SHEET_PATH = "/erp/1";
var SHEET_NAME = "鮮勇報價單";

// Post workflow 從 param 拿當前記錄
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
    // header / 狀態
    報價單號: entry.getFieldValue(1016153),
    單據狀態: entry.getFieldValue(1026328),
    日期狀態: entry.getFieldValue(1026329),
    Approval_status: entry.getFieldValue(1026332),
    // 客戶
    客戶名稱: entry.getFieldValue(1016085),
    // 日期
    報價單日期: entry.getFieldValue(1026478),
    報價有效日期: entry.getFieldValue(1016086),
    // 人員
    承辦人員: entry.getFieldValue(1016089),
    簽核人: entry.getFieldValue(1026476),
    // 簽核細節（backend 收 DTO 用、compose 不輸出、保留給未來擴充）
    簽核開始的日期時間: entry.getFieldValue(1026472),
    簽核結束的日期時間: entry.getFieldValue(1026473),
    送出簽核人: entry.getFieldValue(1026474),
    送出簽核人姓名: entry.getFieldValue(1026475),
    // 附件
    下載: entry.getFieldValue(1026488),
  },
};

util.setHeader("Content-Type", "application/json");
util.setHeader("X-Notify-Secret", GLOBAL_NOTIFY_SECRET);

try {
  // ⚠ 一行寫完 · Ragic Rhino ES5 引擎不支援函數呼叫參數列的尾逗號
  var res = util.postURL(BACKEND_URL + "/notify/ragic/quotation", JSON.stringify(payload));
  log.info("[notify] " + res);
} catch (e) {
  log.error("[notify] failed: " + e);
  // 刻意不 setStatus("ERROR")：LINE 失敗不擋使用者存檔（見 notify.md §7-bis.3）
}
