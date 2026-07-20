// Unit tests: RagicConnector pull + healthCheck · 注入 fake fetch
import { test } from "node:test";
import assert from "node:assert/strict";
import { RagicConnector } from "../src/data-sync-layer/connectors/ragic.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

const BASE_CFG = {
  tenantId: TENANT_ID,
  baseUrl: "https://ap16.ragic.com",
  account: "2026carhouse",
  apiKey: "test-key",
  sheetPaths: {
    order: "/order-operation/11",
    customer: "/customer/8",
    contact: "/contact/9",
  },
  fieldMap: {
    order: {
      orderNo: "1016153",
      customerName: "1016085",
      orderDate: "1026478",
      status: "1026328",
      amount: "1026400",
      ownerName: "1016089",
    },
    customer: { name: "2000001", code: "2000002", category: "2000003" },
    contact: { name: "3000001", email: "3000002", phone: "3000003", lineId: "3000004" },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

test("pullOrders: 正常 pull · 兩筆 · 一筆缺 orderNo 被 skip", async () => {
  const c = new RagicConnector(BASE_CFG);
  c.setFetchImpl(async () =>
    jsonResponse({
      "42": { "1016153": "QT-2026-0001", "1016085": "喬醫", "1026478": "2026/07/20", "1026328": "已核可", "1026400": "50000", "1016089": "王〇〇" },
      "43": { "1016153": "", "1016085": "XXX" },
    }),
  );
  const orders = await c.pullOrders();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].orderNo, "QT-2026-0001");
  assert.equal(orders[0].customerName, "喬醫");
  assert.equal(orders[0].orderDate, "2026-07-20");
  assert.equal(orders[0].status, "已核可");
  assert.equal(orders[0].amount, 50000);
  assert.equal(orders[0].sourceRecordId, "42");
  assert.equal(orders[0].sourceConnector, "ragic");
});

test("pullOrders: sheet path 未設定 → 空陣列 · 不 fetch", async () => {
  let fetched = false;
  const c = new RagicConnector({ ...BASE_CFG, sheetPaths: { customer: "/customer/8" } });
  c.setFetchImpl(async () => {
    fetched = true;
    return jsonResponse({});
  });
  const orders = await c.pullOrders();
  assert.equal(orders.length, 0);
  assert.equal(fetched, false);
});

test("pullCustomers: 用 customer fieldMap", async () => {
  const c = new RagicConnector(BASE_CFG);
  c.setFetchImpl(async () =>
    jsonResponse({
      "1": { "2000001": "喬醫健康事業", "2000002": "C-001", "2000003": "A" },
    }),
  );
  const customers = await c.pullCustomers();
  assert.equal(customers.length, 1);
  assert.equal(customers[0].name, "喬醫健康事業");
  assert.equal(customers[0].code, "C-001");
  assert.equal(customers[0].category, "A");
});

test("pullContacts: lineId 欄位帶入", async () => {
  const c = new RagicConnector(BASE_CFG);
  c.setFetchImpl(async () =>
    jsonResponse({
      "5": { "3000001": "王〇〇", "3000002": "a@b.com", "3000003": "0912-345-678", "3000004": "U1234567890" },
    }),
  );
  const contacts = await c.pullContacts();
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].name, "王〇〇");
  assert.equal(contacts[0].email, "a@b.com");
  assert.equal(contacts[0].lineId, "U1234567890");
});

test("healthCheck: 200 → ok=true · 用 order sheet 當 canary", async () => {
  let capturedUrl = "";
  const c = new RagicConnector(BASE_CFG);
  c.setFetchImpl(async (u) => {
    capturedUrl = String(u);
    return jsonResponse({});
  });
  const r = await c.healthCheck();
  assert.equal(r.ok, true);
  assert.match(capturedUrl, /order-operation\/11/);
  assert.match(capturedUrl, /limit=1/);
  assert.match(capturedUrl, /APIKey=test-key/);
});

test("healthCheck: HTTP 500 → ok=false · error 帶 status", async () => {
  const c = new RagicConnector(BASE_CFG);
  c.setFetchImpl(async () => new Response("boom", { status: 500 }));
  const r = await c.healthCheck();
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /HTTP 500/);
});

test("healthCheck: 網路錯 → ok=false", async () => {
  const c = new RagicConnector(BASE_CFG);
  c.setFetchImpl(async () => {
    throw new Error("ECONNREFUSED");
  });
  const r = await c.healthCheck();
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /ECONNREFUSED/);
});

test("healthCheck: 所有 sheet path 都未設定 → ok=false · error 提示 config", async () => {
  const c = new RagicConnector({ ...BASE_CFG, sheetPaths: {} });
  const r = await c.healthCheck();
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /no sheet path/);
});
