// ============================================================
// Ragic Post Workflow · TB-P01 分析表 → LINE 通知
// ============================================================
// Sheet：/order-operation/11（aitode）
// 觸發：記錄儲存後（Sheet 專屬的 Post-workflow · textarea 多行編輯器）
// Backend：POST /notify/ragic/analysis-sheet
// 對應：docs/modules/notify.md v1.0
//
// ⚠️ 一定要放在「該 sheet 的 Post-workflow」，不是 Global Workflow
//
// 貼用步驟：
// 1. 進 sheet 修改設計 → JavaScript Workflow → 上方切「Post-workflow」
// 2. Cmd+A 清空編輯區
// 3. 貼此整份
// 4. 把 12 個 <FIELD_ID_XXX> 換成 Ragic 修改設計模式抓到的 7 位 field ID
// 5. 把 GLOBAL_NOTIFY_SECRET 換成 .env 內實際值
// 6. 儲存 workflow → 儲存修改設計
// ============================================================

var BACKEND_URL = "https://ai-center-line.onrender.com";
var GLOBAL_NOTIFY_SECRET = "<REPLACE_WITH_NOTIFY_WEBHOOK_SECRET_FROM_ENV>";
var RAGIC_ACCOUNT_URL = "https://ap16.ragic.com/aitode";
var SHEET_PATH = "/order-operation/11";
var SHEET_NAME = "TB-P01 分析表";

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
    // 分析表 header
    分析表編號: entry.getFieldValue(1034502),
    狀態: entry.getFieldValue(1031542),
    // 客戶
    客戶全稱: entry.getFieldValue(1030345),
    聯絡地址: entry.getFieldValue(1030346),
    // 訂購單
    訂購單編號: entry.getFieldValue(1030342),
    訂購單日期: entry.getFieldValue(1030343),
    // 交期
    預交日期: entry.getFieldValue(1032182),
    剩餘天數: entry.getFieldValue(1032185),
    // 部門與稅
    所屬部門: entry.getFieldValue(1034840),
    課稅類別: entry.getFieldValue(1034843),
    // 金額
    未稅合計: entry.getFieldValue(1034845),
    數量合計: entry.getFieldValue(1034844),
  },
};

util.setHeader("Content-Type", "application/json");
util.setHeader("X-Notify-Secret", GLOBAL_NOTIFY_SECRET);

try {
  var res = util.postURL(
    BACKEND_URL + "/notify/ragic/analysis-sheet",
    JSON.stringify(payload),
  );
  log.info("[notify] " + res);
} catch (e) {
  log.error("[notify] failed: " + e);
  // 刻意不 setStatus("ERROR")：LINE 失敗不擋使用者存檔（見 notify.md §7-bis.3）
}
