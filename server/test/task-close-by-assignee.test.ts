/**
 * 當責人自己結束任務（task-close-by-assignee M1）· docs/modules/task-close-by-assignee.md
 *
 * 這個功能的理由：客戶技師看得到任務了，卻沒有任何方式清掉已完成／不用做的。
 * prod 實測 15 個人合計 128 筆未結案，而網頁結案途徑上線至今 0 次。
 *
 * ⚠️⚠️ 最重要的是 F-2（P0）：
 *    `tickets` 的 RLS 只擋跨租戶，**擋不住同租戶跨人** ——
 *    改掉網址裡的 ticketId 就能關掉同事的任務。
 *    唯一擋住它的是 service 裡那行 `assignee_user_id = actor`。
 *
 * ⚠️ 守門測試自己要反向驗證：只斷言「有拋錯」不夠，
 *    也可能是先寫進去了才拋。一定要回頭確認資料**真的沒被動到**。
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTenant, txStore, closeDb } from "../src/db/client.js";
import { WorkStatusService } from "../src/task-completion/work-status.service.js";

const T = "b0da0000-0000-4000-8000-00000000c001";
const DEPT = "b0da0000-0000-4000-8000-0000000000ca";
const ME = "b0da0000-0000-4000-8000-0000000000c1";
const OTHER = "b0da0000-0000-4000-8000-0000000000c2";
const MGR = "b0da0000-0000-4000-8000-0000000000c3";
const T_MINE = "b0da0000-0000-4000-8000-000000000c11";
const T_OTHERS = "b0da0000-0000-4000-8000-000000000c12";
const T_BY_MGR = "b0da0000-0000-4000-8000-000000000c13";

const svc = new WorkStatusService();
const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

// ⚠️ tickets 的 RLS 沒有平台角色逃生門 —— 少設 tenantId 會靜默回 0 列而不是報錯。
const asUser = <R>(userId: string, fn: () => Promise<R>) =>
  withTenant({ tenantId: T, role: "employee", departmentId: DEPT, userId },
    (tx) => txStore.run(tx, fn));

let skip = false;

const mkTicket = (c: pg.Client, id: string, assignee: string) =>
  c.query(
    `INSERT INTO tickets (ticket_id, tenant_id, department_id, summary, status, confidence,
                          confirm_status, assignee_user_id, assign_status, work_status)
     VALUES ($1,$2,$3,$4,'open','high','待簽核',$5,'assigned','open')`,
    [id, T, DEPT, `任務 ${id.slice(-3)}`, assignee],
  );

before(async () => {
  const c = admin();
  try { await c.connect(); } catch { skip = true; return; }
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'TCA-test')`, [T]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1,$2,'維修組','G_TCA','x','x')`, [DEPT, T]);
  for (const [id, nm, em] of [[ME, "我", "me@tca.test"], [OTHER, "同事", "other@tca.test"], [MGR, "主管", "mgr@tca.test"]]) {
    await c.query(`INSERT INTO users (user_id, tenant_id, role, department_id, display_name, email)
                   VALUES ($1,$2,'employee',$3,$4,$5)`, [id, T, DEPT, nm, em]);
  }
  await mkTicket(c, T_MINE, ME);
  await mkTicket(c, T_OTHERS, OTHER);
  await mkTicket(c, T_BY_MGR, ME);
  await c.end();
});

after(async () => {
  if (skip) return;
  const c = admin(); await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.end(); await closeDb();
});

/** 直接用 admin 連線讀（繞過 RLS）—— 驗的是 DB 真實狀態，不是 API 回什麼 */
const stateOf = async (ticketId: string) => {
  const c = admin(); await c.connect();
  const r = await c.query(
    `SELECT work_status, work_outcome, work_closed_by::text, work_closed_via
       FROM tickets WHERE ticket_id = $1`, [ticketId]);
  await c.end();
  return r.rows[0] as { work_status: string; work_outcome: string | null; work_closed_by: string | null; work_closed_via: string | null };
};

test("⭐ 能結束自己的任務，而且真的寫進 DB", async () => {
  if (skip) return;
  await asUser(ME, () => svc.closeByAssignee(T_MINE, "完成", ME));
  const s = await stateOf(T_MINE);
  assert.equal(s.work_status, "closed");
  assert.equal(s.work_outcome, "完成");
  assert.equal(s.work_closed_by, ME, "沒記下是誰結的 —— F-1 的留痕靠這一欄");
  assert.equal(s.work_closed_via, "web");
});

test("⭐ 還原自己標錯的（沒有還原就沒人敢按 · OQ-TCA-4）", async () => {
  if (skip) return;
  await asUser(ME, () => svc.reopenByAssignee(T_MINE, ME));
  const s = await stateOf(T_MINE);
  assert.equal(s.work_status, "open");
  // 半套還原會讓下一次寫入被跨軸約束擋下 —— 相關欄位要一起清乾淨
  assert.equal(s.work_outcome, null);
  assert.equal(s.work_closed_by, null);
  assert.equal(s.work_closed_via, null);
});

test("⭐⭐ F-2（P0）· 不可以關掉別人的任務（RLS 擋不住同租戶跨人）", async () => {
  if (skip) return;
  const before = await stateOf(T_OTHERS);
  assert.equal(before.work_status, "open", "前置條件就不對 —— 這張票本來就不是 open，下面驗不到東西");

  let thrown: unknown = null;
  try {
    await asUser(ME, () => svc.closeByAssignee(T_OTHERS, "完成", ME));
  } catch (e) { thrown = e; }

  assert.ok(thrown, "關別人的任務沒有被擋下來");
  // ⚠️ 只驗「有拋錯」不夠：也可能是先 UPDATE 成功了才拋。
  const after = await stateOf(T_OTHERS);
  assert.equal(after.work_status, "open", "拋錯了但別人的任務已經被關掉");
  assert.equal(after.work_closed_by, null);
});

test("⭐ outcome 白名單 · 「轉他人」「做不到」不給員工（OQ-TCA-8）", async () => {
  if (skip) return;
  for (const bad of ["轉他人", "做不到", "亂填"]) {
    let thrown: unknown = null;
    try { await asUser(ME, () => svc.closeByAssignee(T_MINE, bad, ME)); } catch (e) { thrown = e; }
    assert.ok(thrown, `outcome=${bad} 應該被擋`);
  }
  assert.equal((await stateOf(T_MINE)).work_status, "open", "被擋的路徑不該留下任何寫入");
});

test("⭐ 「不用做了」可以用 —— 它是這次要補的那一個", async () => {
  if (skip) return;
  await asUser(ME, () => svc.closeByAssignee(T_MINE, "不用做了", ME));
  assert.equal((await stateOf(T_MINE)).work_outcome, "不用做了");
  await asUser(ME, () => svc.reopenByAssignee(T_MINE, ME));   // 還原給後面的測試用
});

test("⭐ 已經結束的不再蓋一次（避免把別人的紀錄悄悄換掉）", async () => {
  if (skip) return;
  await asUser(ME, () => svc.closeByAssignee(T_MINE, "完成", ME));
  let thrown: unknown = null;
  try { await asUser(ME, () => svc.closeByAssignee(T_MINE, "不用做了", ME)); } catch (e) { thrown = e; }
  assert.ok(thrown, "重複結束應該被擋");
  assert.equal((await stateOf(T_MINE)).work_outcome, "完成", "第二次結束把第一次的結果蓋掉了");
});

test("⭐⭐ 主管代為結案的，員工不能自己翻掉（那是主管的決定）", async () => {
  if (skip) return;
  // 主管代結案走的是另一支 close()，會記 work_closed_by = 主管
  await asUser(MGR, () => svc.close(T_BY_MGR, "完成", null, MGR));
  assert.equal((await stateOf(T_BY_MGR)).work_closed_by, MGR);

  let thrown: unknown = null;
  try { await asUser(ME, () => svc.reopenByAssignee(T_BY_MGR, ME)); } catch (e) { thrown = e; }
  assert.ok(thrown, "員工翻掉了主管的決定");
  assert.equal((await stateOf(T_BY_MGR)).work_status, "closed", "拋錯了但票已經被還原");
});
