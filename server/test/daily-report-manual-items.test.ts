// 手動加入日報項目 · docs/modules/four-features-reflection.md §5
//
// 這條路原本是死的：同仁今天沒私訊 bot（所以沒有日報列），但有打卡、有被指派任務——
// 那些項目加得進畫面，一按送出卻被擋，錯誤訊息還叫他「請先傳訊息給 bot」。
// 加得進去卻送不出，比一開始就不給他加更糟。
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client.js";
import { PersonalDailyReportRepository } from "../src/personal-daily-report/personal-daily-report.repository.js";

const repo = new PersonalDailyReportRepository();
const TENANT = "77777777-0000-0000-0000-000000000001";

const admin = <T>(fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) =>
  withTenant({ tenantId: TENANT, role: "aiproot_admin", departmentId: null, userId: null }, fn);

async function seedUser(): Promise<string | null> {
  return admin(async (tx) => {
    const uid = randomUUID();
    const r = await tx.execute(sql`
      INSERT INTO users (user_id, tenant_id, role, display_name, email)
      VALUES (${uid}::uuid, ${TENANT}::uuid, 'employee', ${`pdr-${uid.slice(0, 6)}`}, ${`${uid}@t.test`})
      RETURNING user_id::text
    `);
    return r.rows.length ? uid : null;
  });
}

const dropUser = (uid: string) =>
  admin((tx) => tx.execute(sql`DELETE FROM users WHERE user_id = ${uid}::uuid`));

const DATE = "2026-07-28";

test("⭐ 今天沒有日報列 → ensureRow 幫他開一列（不是擋下來）", async () => {
  const uid = await seedUser();
  if (!uid) return;
  try {
    await admin(async (tx) => {
      const before = await repo.getByUserDate(tx, uid, DATE);
      assert.ok(!before, "前提：今天本來沒有日報");

      const { reportId } = await repo.ensureRow(tx, { tenantId: TENANT, userId: uid, reportDate: DATE });
      assert.ok(reportId);

      const after = await repo.getByUserDate(tx, uid, DATE);
      assert.ok(after, "開完之後就查得到了");
      assert.equal(after!.status, "draft");
    });
  } finally { await dropUser(uid); }
});

test("⭐ ensureRow 冪等 · 重複呼叫回同一列（不會一天長出兩份日報）", async () => {
  const uid = await seedUser();
  if (!uid) return;
  try {
    await admin(async (tx) => {
      const a = await repo.ensureRow(tx, { tenantId: TENANT, userId: uid, reportDate: DATE });
      const b = await repo.ensureRow(tx, { tenantId: TENANT, userId: uid, reportDate: DATE });
      assert.equal(a.reportId, b.reportId);
    });
  } finally { await dropUser(uid); }
});

test("⭐ ensureRow 不可蓋掉已送出的日報", async () => {
  const uid = await seedUser();
  if (!uid) return;
  try {
    await admin(async (tx) => {
      const { reportId } = await repo.ensureRow(tx, { tenantId: TENANT, userId: uid, reportDate: DATE });
      await repo.saveFinal(tx, { reportId, finalItems: [{ title: "已送出的內容" } as never], action: "send" });

      await repo.ensureRow(tx, { tenantId: TENANT, userId: uid, reportDate: DATE });
      const after = await repo.getByUserDate(tx, uid, DATE);
      assert.equal(after!.status, "sent", "已送出的狀態不可被重新開列洗掉");
    });
  } finally { await dropUser(uid); }
});
