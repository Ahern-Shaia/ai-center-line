// 分析詳情的存取範圍 · 用戶 2026-07-28 裁定「不開放給客戶端」
//
// 這支測試守的不是「有沒有擋」，而是「**擋的地方跟以為的一樣**」。
//
// 2026-07-28 之前的狀況：前端 nav.ts 只給 aiproot / consultant 看到入口，
// 但後端 @Roles 列了 tenant_admin / group_owner —— 介面藏起來、API 開著。
// RLS 還在所以不會跨租戶，但那個門是假的：我們以為擋住了，實際沒有。
//
// ⚠️ 2026-07-29（M1）：閘門從 @Roles 換成權限碼。原測試的註解本來就寫著
//    「真要開放請走權限引擎，不要改這裡」—— 現在走的正是那條路。
//    但**裁定沒有變**，所以斷言跟著搬家，不是放寬：
//      ① 每個 handler 都要有 convo:* 權限碼（沒有 = 沒受保護）
//      ② 那些權限碼**不可**授予客戶端角色（改讀授權表，比讀 decorator 更貼近真實）
//    ② 比舊版更嚴：舊版只看程式碼寫了什麼，看不到有人在權限管理頁上勾了什麼。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Reflector } from "@nestjs/core";
import { REQUIRE_PERMISSION_KEY } from "../src/permission/require-permission.decorator.js";
import { ConversationAnalysisController } from "../src/conversation-analysis/conversation-analysis.controller.js";

const reflector = new Reflector();
const proto = ConversationAnalysisController.prototype as unknown as Record<string, () => unknown>;
const handlers = Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor");

const CLIENT_SIDE_ROLES = ["tenant_admin", "group_owner", "employee"];

const permsOf = (name: string) =>
  reflector.get<string[]>(REQUIRE_PERMISSION_KEY, proto[name]) ?? [];

test("⭐ 分析詳情的所有端點都由 convo:* 權限碼把關", () => {
  assert.ok(handlers.length >= 5, `應該掃到多個 handler，實際 ${handlers.length}`);
  for (const name of handlers) {
    const perms = permsOf(name);
    assert.ok(perms.length > 0, `${name} 沒有 @RequirePermission —— 未受保護的端點比開錯還糟`);
    assert.ok(
      perms.every((p) => p.startsWith("convo:")),
      `${name} 用了 ${perms.join(",")} —— 分析詳情的權限碼要收在 convo:* 底下，`
      + "散出去之後「誰能看分析」就沒有單一可查的地方了",
    );
  }
});

test("⭐⭐ convo:* 權限不可授予客戶端角色（釘住 2026-07-28 的裁定）", async () => {
  const codes = [...new Set(handlers.flatMap(permsOf))];
  assert.ok(codes.length > 0, "掃不到權限碼的話這條等於沒測");

  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  try {
    const { rows } = await c.query<{ role_key: string; permission_id: string }>(
      `SELECT r.role_key, rp.permission_id
         FROM role_permissions rp JOIN roles r ON r.role_id = rp.role_id
        WHERE r.is_system AND r.role_key = ANY($1) AND rp.permission_id = ANY($2)`,
      [CLIENT_SIDE_ROLES, codes],
    );
    assert.deepEqual(
      rows.map((r) => `${r.role_key} → ${r.permission_id}`), [],
      "分析詳情是我方維運視角（token 用量／標註工具），客戶要對照原文請走任務卡的「查來源」。"
      + "真要開放請先改這條測試並說明理由 —— 別讓它在權限管理頁上被無聲地勾掉。",
    );
  } finally { await c.end(); }
});

after(async () => {
  const { closeDb } = await import("../src/db/client.js");
  await closeDb();
});
