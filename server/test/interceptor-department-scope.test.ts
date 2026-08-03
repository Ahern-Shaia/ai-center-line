// interceptor 決定 RLS 的 current_department · 修 2026-08-03 台灣福祉 GM 任務看板全空。
//
// 背景：migration 0048 讓 tickets RLS 變成「有帶 current_department 就只看該部門」（角色無關）。
// 這是對的（RLS 層防禦）。但 interceptor 原本對**所有角色**都帶 user.department_id，
// 於是 tenant_admin 若個人掛了部門（總經理室 GM 掛「總經理室」部門供組織圖顯示）就被鎖進單一部門。
// 修法：只有部門限定角色（group_owner / employee）才帶部門；看全租戶的角色一律不帶。
import { test } from "node:test";
import assert from "node:assert/strict";
import { contextDepartmentFor } from "../src/tenant/tenant.interceptor.js";

const DEPT = "a928a0a9-69dc-4185-9037-1541be10ec61";

test("⭐⭐ tenant_admin 個人掛了部門也不帶進 current_department（看全租戶，修任務看板全空）", () => {
  assert.equal(contextDepartmentFor("tenant_admin", DEPT), null);
});

test("⭐ 部門限定角色帶自己的部門（保留 0048 對 group_owner / employee 的收斂）", () => {
  assert.equal(contextDepartmentFor("group_owner", DEPT), DEPT);
  assert.equal(contextDepartmentFor("employee", DEPT), DEPT);
});

test("⭐ 其餘看全租戶 / 跨租戶角色一律不帶部門", () => {
  for (const role of ["assistant", "consultant", "aiproot_admin"]) {
    assert.equal(contextDepartmentFor(role, DEPT), null, `角色 ${role} 不應被鎖進單一部門`);
  }
});

test("沒掛部門 → null（不論角色）", () => {
  assert.equal(contextDepartmentFor("group_owner", null), null);
  assert.equal(contextDepartmentFor("tenant_admin", undefined), null);
});
