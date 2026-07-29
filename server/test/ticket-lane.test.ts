// 任務分區判準 · docs/modules/task-materialization-gate.md
//
// 這支測試守的是「40% 的看板不是待辦」那個問題，以及它的反面：
// 修正門檻時**不可以讓真的待辦無聲消失**（F-1 P0），
// 也**不可以讓簽核率掉到 0%**（F-2 P0）。
import { test } from "node:test";
import { TaskConfigService } from "../src/task-config/task-config.service.js";
import assert from "node:assert/strict";
import { laneFor, inSignoffScope, isActionable, RECOMPUTABLE_LANES } from "../src/warroom-task-board/ticket-lane.js";

test("高信心 + 待辦 → 待簽核（原本就該進佇列的）", () => {
  assert.equal(laneFor("high", "open"), "待簽核");
  assert.equal(laneFor("high", "in_progress"), "待簽核");
});

test("⭐ 高信心 + 公告/已完成 → 存查，不是丟掉（F-1 · P0）", () => {
  // prod 實測：15 張任務有 4 張是公告（開會通知、工作回覆規則）、2 張已完成（查修完、結案）
  assert.equal(laneFor("high", "info"), "存查");
  assert.equal(laneFor("high", "resolved"), "存查");
  // 關鍵：不可以回 null。回 null 就是不建卡，AI 一旦誤標 info，那件事會無聲消失
  assert.notEqual(laneFor("high", "info"), null);
  assert.notEqual(laneFor("high", "resolved"), null);
});

test("⭐ 高信心 + 狀態缺漏 → 仍要建卡（缺資料不是消失的理由）", () => {
  assert.equal(laneFor("high", null), "存查");
  assert.equal(laneFor("high", undefined), "存查");
  assert.equal(laneFor("high", "未知狀態"), "存查");
});

test("中信心 + 待辦 → 待確認（原本 64% 完全沒有出口）", () => {
  assert.equal(laneFor("medium", "open"), "待確認");
  assert.equal(laneFor("medium", "in_progress"), "待確認");
});

test("中信心 + 公告/已完成 → 不建卡（打擾成本高於價值）", () => {
  assert.equal(laneFor("medium", "info"), null);
  assert.equal(laneFor("medium", "resolved"), null);
});

test("低信心一律不建卡", () => {
  for (const s of ["open", "in_progress", "info", "resolved", null]) {
    assert.equal(laneFor("low", s), null, `low + ${s} 不該建卡`);
  }
});

test("⭐ 簽核率的分母 · 待確認/已忽略/存查 一律不算（F-2 · P0）", () => {
  // 少了這條，中信心票一進表就讓 dt.every(已簽核) 永遠 false → 簽核率卡在 0%
  assert.equal(inSignoffScope("待簽核"), true);
  assert.equal(inSignoffScope("已簽核"), true);
  assert.equal(inSignoffScope("逾時警示"), true);
  assert.equal(inSignoffScope("待確認"), false);
  assert.equal(inSignoffScope("已忽略"), false);
  assert.equal(inSignoffScope("存查"), false);
  assert.equal(inSignoffScope(null), false);
});

test("⭐ 人動過的區不可被重跑覆寫（F-3）", () => {
  // 已簽核／已忽略／逾時警示 = 人的決定。重跑復活的話，主管第二次就不會再點了
  assert.ok(!RECOMPUTABLE_LANES.includes("已簽核"));
  assert.ok(!RECOMPUTABLE_LANES.includes("已忽略"));
  assert.ok(!RECOMPUTABLE_LANES.includes("逾時警示"));
  // 沒人動過的可以隨 AI 重算
  assert.ok(RECOMPUTABLE_LANES.includes("待簽核"));
  assert.ok(RECOMPUTABLE_LANES.includes("待確認"));
  assert.ok(RECOMPUTABLE_LANES.includes("存查"));
});

test("isActionable · 只有 open / in_progress 算還要做的事", () => {
  assert.equal(isActionable("open"), true);
  assert.equal(isActionable("in_progress"), true);
  assert.equal(isActionable("info"), false);
  assert.equal(isActionable("resolved"), false);
  assert.equal(isActionable(null), false);
});

test("⭐ 用 prod 實際分布回推 · 15 張裡應有 9 張留在待簽核、6 張轉存查", () => {
  // 2026-07-27 prod 快照：in_progress 5 / open 4 / info 4 / resolved 2
  const snapshot = [
    ...Array(5).fill("in_progress"), ...Array(4).fill("open"),
    ...Array(4).fill("info"), ...Array(2).fill("resolved"),
  ];
  const lanes = snapshot.map((s) => laneFor("high", s));
  assert.equal(lanes.filter((l) => l === "待簽核").length, 9, "待辦應剩 9 張");
  assert.equal(lanes.filter((l) => l === "存查").length, 6, "公告與已完成應轉存查 6 張");
  assert.equal(lanes.filter((l) => l === null).length, 0, "一張都不可以消失");
});

// ── 真的打到資料庫的部分 ────────────────────────────────────────
// 上面全是純函式測試，SQL 寫壞它們一個都不會紅。
// 2026-07-28 就是這樣讓 `= ANY(${jsArray})` 溜過去的 ——
// Drizzle 把 JS 陣列展成 tuple `ANY(($1,$2))`，Postgres 直接 42809，
// 型別檢查全綠、單元測試全綠，要按下按鈕才炸。
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant, txStore, type Db } from "../src/db/client.js";
import { WarroomTasksService } from "../src/warroom/warroom-tasks.service.js";

const tasksSvc = new WarroomTasksService(new TaskConfigService());

async function seedTicket(lane: string): Promise<{ tenantId: string; ticketId: string } | null> {
  return withTenant({ tenantId: null, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
    const d = await tx.execute<{ department_id: string; tenant_id: string }>(sql`
      SELECT department_id::text, tenant_id::text FROM departments LIMIT 1
    `);
    const row = d.rows[0];
    if (!row) return null;
    const r = await tx.execute<{ ticket_id: string }>(sql`
      INSERT INTO tickets (tenant_id, department_id, summary, confidence, status, confirm_status)
      VALUES (${row.tenant_id}::uuid, ${row.department_id}::uuid,
              ${`lanetest-${randomUUID().slice(0, 8)}`}, 'medium', 'open', ${lane})
      RETURNING ticket_id::text
    `);
    return { tenantId: row.tenant_id, ticketId: r.rows[0].ticket_id };
  });
}

const drop = (id: string) =>
  withTenant({ tenantId: null, role: "aiproot_admin", departmentId: null, userId: null }, (tx) =>
    tx.execute(sql`DELETE FROM tickets WHERE ticket_id = ${id}::uuid`));

const asAdmin = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  withTenant({ tenantId, role: "tenant_admin", departmentId: null, userId: null },
    (tx: Db) => txStore.run(tx, fn));

async function laneOf(id: string): Promise<string | null> {
  return withTenant({ tenantId: null, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
    const r = await tx.execute<{ confirm_status: string }>(sql`
      SELECT confirm_status FROM tickets WHERE ticket_id = ${id}::uuid
    `);
    return r.rows[0]?.confirm_status ?? null;
  });
}

test("⭐ 收為任務 · SQL 真的跑得起來（待確認 → 待簽核）", async () => {
  const t = await seedTicket("待確認");
  if (!t) return;
  try {
    await asAdmin(t.tenantId, () => tasksSvc.decideTicket(t.ticketId, true, randomUUID()));
    assert.equal(await laneOf(t.ticketId), "待簽核");
  } finally { await drop(t.ticketId); }
});

test("⭐ 不用追 · 待確認 → 已忽略", async () => {
  const t = await seedTicket("待確認");
  if (!t) return;
  try {
    await asAdmin(t.tenantId, () => tasksSvc.decideTicket(t.ticketId, false, randomUUID()));
    assert.equal(await laneOf(t.ticketId), "已忽略");
  } finally { await drop(t.ticketId); }
});

test("⭐ 按錯救得回來 · 已忽略 → 待簽核", async () => {
  const t = await seedTicket("已忽略");
  if (!t) return;
  try {
    await asAdmin(t.tenantId, () => tasksSvc.decideTicket(t.ticketId, true, randomUUID()));
    assert.equal(await laneOf(t.ticketId), "待簽核");
  } finally { await drop(t.ticketId); }
});

test("⭐ 已忽略不可被「不用追」再動一次（只有 accept 能救回）", async () => {
  const t = await seedTicket("已忽略");
  if (!t) return;
  try {
    await asAdmin(t.tenantId, async () => {
      await assert.rejects(() => tasksSvc.decideTicket(t.ticketId, false, randomUUID()));
    });
    assert.equal(await laneOf(t.ticketId), "已忽略");
  } finally { await drop(t.ticketId); }
});

test("⭐ 已簽核的票不可被 decision 改動（人的決定優先）", async () => {
  const t = await seedTicket("已簽核");
  if (!t) return;
  try {
    await asAdmin(t.tenantId, async () => {
      await assert.rejects(() => tasksSvc.decideTicket(t.ticketId, true, randomUUID()));
    });
    assert.equal(await laneOf(t.ticketId), "已簽核");
  } finally { await drop(t.ticketId); }
});
