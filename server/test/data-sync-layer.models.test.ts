// Unit tests: Zod schema parse for 3 canonical entities
import { test } from "node:test";
import assert from "node:assert/strict";
import { OrderSchema } from "../src/data-sync-layer/models/order.js";
import { CustomerSchema } from "../src/data-sync-layer/models/customer.js";
import { ContactSchema } from "../src/data-sync-layer/models/contact.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

test("order: 最小欄位（tenantId+source+orderNo）解析成功 · currency default TWD", () => {
  const r = OrderSchema.safeParse({
    tenantId: TENANT_ID,
    sourceConnector: "ragic",
    sourceRecordId: "42",
    orderNo: "QT-2026-0001",
  });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.currency, "TWD");
    assert.equal(r.data.writeBackStatus, "synced");
    assert.deepEqual(r.data.raw, {});
  }
});

test("order: orderNo 為空 → parse fail", () => {
  const r = OrderSchema.safeParse({
    tenantId: TENANT_ID,
    sourceConnector: "ragic",
    sourceRecordId: "42",
    orderNo: "",
  });
  assert.equal(r.success, false);
});

test("order: date 格式 YYYY-MM-DD 通過 · 其他格式失敗", () => {
  const ok = OrderSchema.safeParse({
    tenantId: TENANT_ID,
    sourceConnector: "ragic",
    sourceRecordId: "42",
    orderNo: "X",
    orderDate: "2026-07-20",
  });
  assert.equal(ok.success, true);

  const bad = OrderSchema.safeParse({
    tenantId: TENANT_ID,
    sourceConnector: "ragic",
    sourceRecordId: "42",
    orderNo: "X",
    orderDate: "2026/07/20",
  });
  assert.equal(bad.success, false);
});

test("customer: contactEmail 空字串 / 一般字串 / 超長字串 · 前兩者過 · 超長 fail", () => {
  const empty = CustomerSchema.safeParse({
    tenantId: TENANT_ID,
    sourceConnector: "ragic",
    sourceRecordId: "1",
    name: "喬醫健康事業",
    contactEmail: "",
  });
  assert.equal(empty.success, true);

  const normal = CustomerSchema.safeParse({
    tenantId: TENANT_ID,
    sourceConnector: "ragic",
    sourceRecordId: "1",
    name: "喬醫健康事業",
    contactEmail: "a@b.com",
  });
  assert.equal(normal.success, true);

  const tooLong = CustomerSchema.safeParse({
    tenantId: TENANT_ID,
    sourceConnector: "ragic",
    sourceRecordId: "1",
    name: "喬醫健康事業",
    contactEmail: "x".repeat(300),
  });
  assert.equal(tooLong.success, false);
});

test("contact: customerId 為 uuid（可 null）", () => {
  const okNull = ContactSchema.safeParse({
    tenantId: TENANT_ID,
    sourceConnector: "ragic",
    sourceRecordId: "1",
    name: "王〇〇",
    customerId: null,
  });
  assert.equal(okNull.success, true);

  const okUuid = ContactSchema.safeParse({
    tenantId: TENANT_ID,
    sourceConnector: "ragic",
    sourceRecordId: "1",
    name: "王〇〇",
    customerId: "22222222-2222-2222-2222-222222222222",
  });
  assert.equal(okUuid.success, true);

  const badUuid = ContactSchema.safeParse({
    tenantId: TENANT_ID,
    sourceConnector: "ragic",
    sourceRecordId: "1",
    name: "王〇〇",
    customerId: "not-uuid",
  });
  assert.equal(badUuid.success, false);
});
