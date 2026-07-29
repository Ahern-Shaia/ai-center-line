// 每日回報 → 回「尚未確認完成」清單（M3.5）
// docs/modules/task-completion-tracking.md §2.3 · §2.5
//
// ⭐ 樣式偵測用 prod 真實回報格式當案例。
// 技術工程部組長群每晚固定 5 個人在發，而且是自願的 ——
// 我們要搭的是這個既有習慣，不是另外建一個新動作。
import { test, before, after } from "node:test";
import pg from "pg";
import { TaskConfigService } from "../src/task-config/task-config.service.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant, withSystemTx } from "../src/db/client.js";
import { isDailyReport, tierFor } from "../src/task-completion/daily-report-pattern.js";
import { OpenTaskReminderService } from "../src/task-completion/open-task-reminder.service.js";

// ── 樣式偵測（純函式）─────────────────────────────────────────────

test("⭐ prod 真實回報格式都要認得出來", () => {
  assert.ok(isDailyReport("今日工作內容回報\n\n台中智障者協會（2區）\n一台更換後鏡頭（3500）"));
  assert.ok(isDailyReport("今日進度回報\n嘉義安道基金會\n朴子站\n保養一台（3500）"));
  assert.ok(isDailyReport("7/27 阿斌\n晨會\n人員工作安排確認\n簽核請購單"));
  assert.ok(isDailyReport("7/27大文\n晨會\n產線人員工作安排\nJS日峰品檢缺失修繕完畢"));
  assert.ok(isDailyReport("7/27～勝傑\n晨會\n工位協助施工"));
});

test("⭐ 普通聊天不可誤判成回報（拿不準就不回）", () => {
  // 亂回一次很吵，還會被當成機器人亂回（F-21）
  assert.equal(isDailyReport("好👌"), false);
  assert.equal(isDailyReport("明天早上可約去商協,安排一下"), false);
  assert.equal(isDailyReport("7/28 記得帶資料"), false, "只有開頭像日期但沒列事項");
  assert.equal(isDailyReport("我問他們了，等他們回一下"), false);
  assert.equal(isDailyReport(""), false);
  assert.equal(isDailyReport(null), false);
});

test("單行訊息一律不算回報", () => {
  assert.equal(isDailyReport("7/27 阿斌"), false);
  assert.equal(isDailyReport("晨會"), false);
});

test("⭐ 提醒的升級階梯：不重複而是往上送", () => {
  const D: [number, number] = [3, 7];        // DEFAULT_TASK_CONFIG.tierDays
  assert.equal(tierFor(1, D), "normal");
  assert.equal(tierFor(3, D), "normal");
  assert.equal(tierFor(4, D), "aged");
  assert.equal(tierFor(7, D), "aged");
  assert.equal(tierFor(8, D), "escalate", "8 天起改浮到主管端，不再對他重複");
  assert.equal(tierFor(30, D), "escalate");

  // ⭐ 階梯是 per-tenant 的（維修 7 天合理、詢價太長）· tenant_task_config
  const short: [number, number] = [1, 2];
  assert.equal(tierFor(2, short), "aged", "同樣 2 天，短階梯的公司已經升級");
  assert.equal(tierFor(3, short), "escalate");
  assert.equal(tierFor(3, D), "normal", "同一個天數在不同公司會落在不同級 —— 這正是要的");
});

// ── 端到端 ────────────────────────────────────────────────────────

const svc = new OpenTaskReminderService(new TaskConfigService());

interface Seed {
  tenantId: string; groupId: string; lineUserId: string; name: string;
  cleanup: () => Promise<void>;
}

/**
 * ⚠️ 專用租戶，**不可**用 `SELECT ... FROM line_group LIMIT 1` 撈現成的。
 *
 * 2026-07-29 實際炸過：另一個檔案（daily-log-and-media）會建立又刪除帶部門的群組，
 * 而原本這裡的 `LIMIT 1` 沒有 ORDER BY —— Postgres 可能回它建的那一列，
 * 然後那個檔案的 `after()` 把租戶刪掉（cascade 連 line_group / departments 一起），
 * 這支測試跑到一半就找不到部門（`dept.rows[0]` undefined）。
 * node --test 各檔案是平行的 process，拿共用可變資料當 fixture ＝ 自找 flake。
 */
const T_DR = "d2d2d2d2-0000-4000-8000-00000000d201";
const DEPT_DR = "d2d2d2d2-0000-4000-8000-00000000de02";
const BOT_DR = "d2d2d2d2-0000-4000-8000-0000000b0703";
const GROUP_DR = "Cdr_reminder_00000000000000001";

const adminClient = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

before(async () => {
  const c = adminClient();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T_DR]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1, 'DR-TEST')`, [T_DR]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1, $2, 'dr-dept', $3, 'x', 'x')`, [DEPT_DR, T_DR, GROUP_DR]);
  const key = process.env.LINE_CONFIG_ENC_KEY ?? "test-only-line-enc-key-32chars---";
  await c.query(
    `INSERT INTO line_bot (bot_id, tenant_id, name, bot_user_id, channel_secret_enc, channel_access_token_enc)
     VALUES ($1,$2,'dr-bot','U_dr_bot', pgp_sym_encrypt('s',$3), pgp_sym_encrypt('t',$3))`, [BOT_DR, T_DR, key]);
  await c.query(
    `INSERT INTO line_group (bot_id, group_id, department_id, analyze_enabled, display_name)
     VALUES ($1,$2,$3,true,'提醒測試群')`, [BOT_DR, GROUP_DR, DEPT_DR]);
  await c.end();
});

after(async () => {
  const c = adminClient();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T_DR]);   // cascade 清其餘
  await c.end();
});

async function seed(): Promise<Seed | null> {
  const name = `測試員_${randomUUID().slice(0, 6)}`;
  const lineUserId = `U_${randomUUID().slice(0, 10)}`;
  return withSystemTx(async (tx) => {
    await tx.execute(sql`
      INSERT INTO line_member (tenant_id, bot_id, group_id, user_id, display_name)
      VALUES (${T_DR}::uuid, ${BOT_DR}::uuid, ${GROUP_DR}, ${lineUserId}, ${name})
    `);
    return {
      tenantId: T_DR, groupId: GROUP_DR, lineUserId, name,
      cleanup: async () => {
        await withTenant({ tenantId: T_DR, role: "tenant_admin", departmentId: null, userId: null },
          (t) => t.execute(sql`DELETE FROM tickets WHERE assignee_display_name = ${name}`));
        await withSystemTx((t) => t.execute(sql`DELETE FROM line_member WHERE user_id = ${lineUserId}`));
      },
    };
  });
}

async function addTicket(s: Seed, summary: string, daysAgo: number, confirm = "待簽核") {
  await withTenant({ tenantId: s.tenantId, role: "tenant_admin", departmentId: null, userId: null },
    (tx) => tx.execute(sql`
      INSERT INTO tickets (tenant_id, department_id, summary, confirm_status,
                           assignee_display_name, created_at)
      VALUES (${s.tenantId}::uuid, ${DEPT_DR}::uuid, ${summary}, ${confirm},
              ${s.name}, now() - ${`${daysAgo} days`}::interval)
    `));
}

const ask = (s: Seed, text: string) =>
  svc.replyForDailyReport({
    tenantId: s.tenantId, groupId: s.groupId, senderLineUserId: s.lineUserId, text,
  });

const REPORT = "今日工作內容回報\n\n三號機停機檢查\n協助二線換模";

test("⭐ 發了回報就附上清單，且措辭是「尚未確認完成」", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addTicket(s, "更換三號機軸承", 2);
    await addTicket(s, "五號機定期保養", 1);
    const reply = await ask(s, REPORT);
    assert.ok(reply, "發了回報就該回");
    assert.ok(reply!.includes("尚未確認完成"), "不可用「未完成」—— 人做完但沒回報時那個標籤是假的");
    assert.ok(reply!.includes("更換三號機軸承"));
    assert.ok(reply!.includes("2 件"));
  } finally { await s.cleanup(); }
});

test("⭐ 沒發回報就不回（沒發本身是主管該看到的訊號，不是同仁的負擔）", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addTicket(s, "更換三號機軸承", 2);
    assert.equal(await ask(s, "好👌"), null);
    assert.equal(await ask(s, "明天早上可約去商協"), null);
  } finally { await s.cleanup(); }
});

test("⭐ 0 件時不回（連「今天沒有待確認的」都不要回）", async () => {
  const s = await seed();
  if (!s) return;
  try {
    assert.equal(await ask(s, REPORT), null);
  } finally { await s.cleanup(); }
});

test("⭐ 每人每日至多 1 則（同一天發兩次回報不會被回兩串）", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addTicket(s, "更換三號機軸承", 2);
    assert.ok(await ask(s, REPORT));
    assert.equal(await ask(s, REPORT), null, "第二次不回 —— 回兩次就是催辦了");
  } finally { await s.cleanup(); }
});

test("⭐ 開超過 7 天的不再對他重複，改由主管端處理", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addTicket(s, "躺很久的任務", 12);
    assert.equal(await ask(s, REPORT), null, "只剩久懸的就整串不回 —— 那是主管的事");
  } finally { await s.cleanup(); }
});

test("4–7 天的要標出天數（提醒要升級不是重複同一句）", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addTicket(s, "拖了一陣子的任務", 5);
    const reply = await ask(s, REPORT);
    assert.ok(reply!.includes("已 5 天未確認"));
  } finally { await s.cleanup(); }
});

test("⭐ 待確認的任務不進清單（主管還沒認可為任務）", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addTicket(s, "中信心待確認", 1, "待確認");
    assert.equal(await ask(s, REPORT), null, "提早出現＝要他做一件公司還沒決定要做的事");
  } finally { await s.cleanup(); }
});

test("已結束的任務不進清單", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addTicket(s, "已經做完的", 2);
    await withTenant({ tenantId: s.tenantId, role: "tenant_admin", departmentId: null, userId: null },
      (tx) => tx.execute(sql`
        UPDATE tickets SET work_status='closed', work_outcome='完成', work_closed_at=now()
         WHERE assignee_display_name = ${s.name}
      `));
    assert.equal(await ask(s, REPORT), null);
  } finally { await s.cleanup(); }
});
