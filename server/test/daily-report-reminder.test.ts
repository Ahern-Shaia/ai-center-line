// 每日回報 → 回「尚未確認完成」清單（M3.5）
// docs/modules/task-completion-tracking.md §2.3 · §2.5
//
// ⭐ 樣式偵測用 prod 真實回報格式當案例。
// 技術工程部組長群每晚固定 5 個人在發，而且是自願的 ——
// 我們要搭的是這個既有習慣，不是另外建一個新動作。
import { test } from "node:test";
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
  assert.equal(tierFor(1), "normal");
  assert.equal(tierFor(3), "normal");
  assert.equal(tierFor(4), "aged");
  assert.equal(tierFor(7), "aged");
  assert.equal(tierFor(8), "escalate", "8 天起改浮到主管端，不再對他重複");
  assert.equal(tierFor(30), "escalate");
});

// ── 端到端 ────────────────────────────────────────────────────────

const svc = new OpenTaskReminderService();

interface Seed {
  tenantId: string; groupId: string; lineUserId: string; name: string;
  cleanup: () => Promise<void>;
}

async function seed(): Promise<Seed | null> {
  const name = `測試員_${randomUUID().slice(0, 6)}`;
  const lineUserId = `U_${randomUUID().slice(0, 10)}`;
  return withSystemTx(async (tx) => {
    const g = await tx.execute<{ group_id: string; tenant_id: string; bot_id: string; department_id: string }>(sql`
      SELECT g.group_id, b.tenant_id::text, b.bot_id::text, g.department_id::text
        FROM line_group g JOIN line_bot b ON b.bot_id = g.bot_id
       WHERE g.department_id IS NOT NULL LIMIT 1
    `);
    const grp = g.rows[0];
    if (!grp) return null;
    await tx.execute(sql`
      INSERT INTO line_member (tenant_id, bot_id, group_id, user_id, display_name)
      VALUES (${grp.tenant_id}::uuid, ${grp.bot_id}::uuid, ${grp.group_id}, ${lineUserId}, ${name})
    `);
    return {
      tenantId: grp.tenant_id, groupId: grp.group_id, lineUserId, name,
      cleanup: async () => {
        await withTenant({ tenantId: grp.tenant_id, role: "tenant_admin", departmentId: null, userId: null },
          (t) => t.execute(sql`DELETE FROM tickets WHERE assignee_display_name = ${name}`));
        await withSystemTx((t) => t.execute(sql`DELETE FROM line_member WHERE user_id = ${lineUserId}`));
      },
    };
  });
}

async function addTicket(s: Seed, summary: string, daysAgo: number, confirm = "待簽核") {
  const dept = await withSystemTx((tx) => tx.execute<{ id: string }>(sql`
    SELECT department_id::text AS id FROM line_group WHERE group_id = ${s.groupId} LIMIT 1
  `));
  await withTenant({ tenantId: s.tenantId, role: "tenant_admin", departmentId: null, userId: null },
    (tx) => tx.execute(sql`
      INSERT INTO tickets (tenant_id, department_id, summary, confirm_status,
                           assignee_display_name, created_at)
      VALUES (${s.tenantId}::uuid, ${dept.rows[0].id}::uuid, ${summary}, ${confirm},
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
