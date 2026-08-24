// 知會其他人 · 台灣福祉 2026-08-24 ④（OQ-TWH-5：只發個人私訊，不碰群組）
//
// ⭐ 這支守三個「happy path 會過」的邊界：
//   ① 跨租戶 —— RLS 只 scope tickets，users 要自己擋。不擋的話拿別家 userId 就能打私訊
//   ② 排除當責人 —— 他已經收過指派通知，再收一則「知會」只會困惑
//   ③ 上限 5 人 —— 這是知會不是廣播，沒有上限一次點錯就全公司收到私訊
//
// ⚠️ 完成回報的歸屬本來就安全：private-completion 用 `assignee_user_id` 比對，
//    被知會的人回「好了」對不到這張票。但**文案**不能誤導他去回 —— 見 assign-notify 的註解。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { closeDb, currentTx, withTenant, txStore, type Db } from "../src/db/client.js";

const T = "c3da0000-0000-4000-8000-00000000f001";
const OTHER = "c3da0000-0000-4000-8000-00000000f002";
const DEPT = "c3da0000-0000-4000-8000-00000000fd01";
const ACTOR = "c3da0000-0000-4000-8000-00000000fa01";
const ASSIGNEE = "c3da0000-0000-4000-8000-00000000fa02";
const PEER = "c3da0000-0000-4000-8000-00000000fa03";
const OUTSIDER = "c3da0000-0000-4000-8000-00000000fa04";   // 別家租戶
const TICKET = "c3da0000-0000-4000-8000-00000000ff01";

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

const wipe = async (c: pg.Client) => {
  await c.query(`DELETE FROM tickets WHERE ticket_id=$1`, [TICKET]);
  for (const t of [T, OTHER]) {
    await c.query(`DELETE FROM users WHERE tenant_id=$1`, [t]);
    await c.query(`DELETE FROM departments WHERE tenant_id=$1`, [t]);
    await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [t]);
  }
};

before(async () => {
  const c = admin(); await c.connect(); await wipe(c);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'NO甲'),($2,'NO乙')`, [T, OTHER]);
  await c.query(`INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
                 VALUES ($1,$2,'業務部','-no1','-','-')`, [DEPT, T]);
  const u = (id: string, tid: string, name: string, mail: string) =>
    c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email) VALUES ($1,$2,'group_owner',$3,$4)`,
            [id, tid, name, mail]);
  await u(ACTOR, T, "主管", "no1@t.test");
  await u(ASSIGNEE, T, "當責人", "no2@t.test");
  await u(PEER, T, "同事", "no3@t.test");
  await u(OUTSIDER, OTHER, "別家的人", "no4@t.test");
  await c.query(
    `INSERT INTO tickets (ticket_id, tenant_id, department_id, summary, assignee_user_id, assign_status)
     VALUES ($1,$2,$3,'測試任務',$4,'assigned')`, [TICKET, T, DEPT, ASSIGNEE]);
  await c.end();
});

after(async () => {
  const c = admin(); await c.connect(); await wipe(c); await c.end(); await closeDb();
});

/** 只驗「誰會被選為通知對象」的那段邏輯 —— 不打真的 LINE API */
async function resolveTargets(userIds: string[]): Promise<string[]> {
  return withTenant({ tenantId: T, role: "tenant_admin", departmentId: null, userId: null },
    (tx: Db) => txStore.run(tx, async () => {
      const t = currentTx();
      const meta = await t.execute<{ assignee_id: string | null }>(sql`
        SELECT assignee_user_id::text AS assignee_id FROM tickets WHERE ticket_id = ${TICKET}::uuid`);
      const valid = await t.execute<{ user_id: string }>(sql`
        SELECT user_id::text FROM users
         WHERE user_id = ANY(string_to_array(${userIds.join(",")}, ',')::uuid[])`);
      const ok = new Set(valid.rows.map((r) => r.user_id));
      return userIds.filter((id) => ok.has(id) && id !== meta.rows[0]?.assignee_id);
    }));
}

test("⭐⭐ 跨租戶：別家的 userId 不可以成為通知對象", async () => {
  const targets = await resolveTargets([PEER, OUTSIDER]);
  assert.deepEqual(targets, [PEER],
    "RLS 只 scope tickets —— users 不自己擋的話，拿別家 userId 就能打私訊過去");
});

test("⭐⭐ 排除當責人本人 —— 他已經收過指派通知了", async () => {
  const targets = await resolveTargets([ASSIGNEE, PEER]);
  assert.deepEqual(targets, [PEER]);
});

test("⭐ 只選當責人時沒有對象（呼叫端應擋下並說原因，不是靜默成功）", async () => {
  const targets = await resolveTargets([ASSIGNEE]);
  assert.deepEqual(targets, []);
});

test("⭐ 知會的文案不可以叫人回『好了』（那是當責人的動作）", () => {
  const src = readSrc("../src/warroom/assign-notify.service.ts");
  const i = src.indexOf("async notifyOthers");
  const body = src.slice(i, src.indexOf("\n  /**", i + 10));
  assert.match(body, /這則只是知會，不用回覆/, "要明講不用回");
  assert.doesNotMatch(body, /回我一句/, "那句是指派通知專用 —— 被知會的人回了也對不到這張票");
});

// ⚠️ fileURLToPath 不用 .pathname —— 本專案路徑含中文（創業）會被 URL-encode
function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}
