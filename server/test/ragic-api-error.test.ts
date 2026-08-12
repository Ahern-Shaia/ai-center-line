// Ragic API 的錯誤處理
//
// ⚠️ Ragic 的錯誤是**用 HTTP 200 回的**（docs/ragic-http-api-手冊.md §15）：
//   { "status":"ERROR", "code":106, "msg":"..." }
//
// 舊版只看 res.ok，於是錯誤 body 一路往下流，最後在 fetchSchemaFields 變成
// 「Ragic schema 回應無 fields（API key 權限不足？需帳號管理者）」——
// 那句話**是程式自己猜的**（連問號都寫在裡面）。
//
// 2026-07-29 prod 實際代價：使用者照著那句猜測，去 Ragic 換成帳號管理者的金鑰，
// 還是失敗，因為真正的原因根本不是權限。錯誤訊息把人導到錯的方向，
// 比只說「失敗了」更糟。
import { test } from "node:test";
import assert from "node:assert/strict";
import { RagicApiClient } from "../src/ragic/ragic-api.client.js";

const ACC = { server: "ap16", apname: "demo", apiKey: "k" };

/** 假的 fetch · 回指定 body（一律 HTTP 200，這正是 Ragic 的行為） */
function stubFetch(body: unknown) {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
  return () => { globalThis.fetch = orig; };
}

async function schemaError(body: unknown): Promise<string> {
  const restore = stubFetch(body);
  try {
    await new RagicApiClient().fetchSchemaFields(ACC, "/sales/1");
    return "（沒有拋錯）";
  } catch (e) {
    return (e as Error).message;
  } finally { restore(); }
}

test("⭐⭐ HTTP 200 但 status=ERROR → 要拋出 Ragic 講的原因，不是我們猜的", async () => {
  const m = await schemaError({ status: "ERROR", code: 102, msg: "invalid path" });
  assert.ok(m.includes("表單路徑"), `應指出路徑問題，實際：${m}`);
  assert.ok(!m.includes("權限"), `⚠️ 不可以把路徑錯誤講成權限問題 —— 那會讓人去換金鑰。實際：${m}`);
  assert.ok(m.includes("invalid path"), "要附上 Ragic 原文，方便對照");
});

test("⭐ 真的是權限問題（106）才講權限", async () => {
  const m = await schemaError({ status: "ERROR", code: 106 });
  assert.ok(m.includes("帳號管理者"), `應指出需要帳號管理者，實際：${m}`);
});

test("⭐ 各錯誤碼都要指出「該去改哪一格」，不只翻譯", async () => {
  for (const [code, must] of [[101, "帳號名"], [103, "表單索引"], [304, "金鑰"]] as const) {
    const m = await schemaError({ status: "ERROR", code });
    assert.ok(m.includes(must), `代碼 ${code} 應提到「${must}」，實際：${m}`);
  }
});

test("沒見過的錯誤碼也要把代碼帶出來（不可吞掉）", async () => {
  const m = await schemaError({ status: "ERROR", code: 999, msg: "weird" });
  assert.ok(m.includes("999") && m.includes("weird"));
});

test("⭐⭐ 回 200、不是 ERROR、但就是沒有 fields → 講實際收到什麼，不要猜", async () => {
  const m = await schemaError({ sheet: { sheetName: "x" }, subtables: [] });
  assert.ok(!m.includes("權限不足"), `⚠️ 不可以猜成權限問題。實際：${m}`);
  assert.ok(m.includes("sheet") && m.includes("subtables"), `要列出實際收到的內容，實際：${m}`);
});

test("正常回應照常解析", async () => {
  const restore = stubFetch({
    sheet: { sheetName: "維修保養單" },
    fields: [{ fieldId: 1001, fieldName: "客戶名稱", type: "text" }],
  });
  try {
    const r = await new RagicApiClient().fetchSchemaFields(ACC, "/sales/1");
    assert.equal(r.sheetName, "維修保養單");
    assert.equal(r.fields.length, 1);
  } finally { restore(); }
});

// ── 2026-08-12 · 兩個讓好訊息到不了使用者眼前的問題 ──────────────────
//
// 用戶回報：填了 `/erp/1?PAGEID=WiL`（從瀏覽器網址列複製必然會帶的參數），
// 按「抓取欄位」只看到「系統目前忙碌，請稍後再試」。
//
// 真相是兩件事疊在一起：
//   ① 路徑帶了 query → Ragic 回錯誤碼 102
//   ② 那個錯誤 `throw new Error(...)` 是普通 Error → Nest 轉 500 且**把訊息換掉** →
//      前端把 500 一律譯成「系統目前忙碌」。於是 102 那句「不要帶問號後面的內容」
//      根本到不了使用者眼前。

test("⭐⭐ 表單路徑自動去掉 ?query —— 從網址列複製一定會帶，不該要使用者自己看懂", () => {
  const n = RagicApiClient.normalizeSheetPath;
  assert.equal(n("/erp/1?PAGEID=WiL"), "/erp/1", "問號後面一律砍掉");
  assert.equal(n("erp/1"), "/erp/1", "沒有開頭斜線要補");
  assert.equal(n("  /erp/1  "), "/erp/1", "前後空白要去掉");
  assert.equal(n("/erp/1/"), "/erp/1", "結尾斜線要去掉");
  assert.equal(n("/erp/1#top"), "/erp/1", "錨點也砍掉");
  assert.equal(n("/service-tickets/10"), "/service-tickets/10", "正常路徑不動");
});

test("⭐⭐ Ragic 錯誤要用 HttpException 丟 —— 普通 Error 會被 Nest 換成「系統目前忙碌」", async () => {
  const restore = stubFetch({ status: "ERROR", code: 102, msg: "invalid path" });
  try {
    const client = new RagicApiClient();
    await client.fetchSchemaFields(ACC, "/erp/1").then(
      () => assert.fail("應該要拋錯"),
      (err: { status?: number; message?: string; getStatus?: () => number }) => {
        const code = typeof err.getStatus === "function" ? err.getStatus() : err.status;
        assert.equal(code, 400, "要是 4xx —— 500 的訊息會被 Nest 吃掉，前端只剩「系統目前忙碌」");
        assert.match(String(err.message), /表單路徑無效/, "要保留可行動的原因");
      },
    );
  } finally { restore(); }
});
