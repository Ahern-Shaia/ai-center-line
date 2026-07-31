// 通用 ID bot（group-id-onboarding M1）· webhook 行為
//
// 守 FMEA 的 P0：通用 bot「設計上沒有 ingestion 路徑」——
//   加進群 / 打「群組ID」→ 回覆該群 ID，但**絕不** upsert line_group、不落任何訊息。
//   若哪天有人手滑讓 utility 分支往下掉進落庫主線，這支測試會抓到（line_group 冒出一列）。
//
// 另守：非關鍵字的一般群訊息 → 通用 bot 完全不回、不落庫（它只做「回 ID」一件事）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { withSystemTx } from "../src/db/client.js";
import { LineWebhookService } from "../src/line-ingest/line-webhook.service.js";
import { LineBotRepository } from "../src/line-ingest/line-bot.repository.js";
import { LineGroupRepository } from "../src/line-ingest/line-group.repository.js";

const SECRET = "utility-bot-secret";

async function seedUtilityBot(): Promise<{ botId: string; botUserId: string }> {
  const botUserId = `Uutil${randomUUID().replace(/-/g, "").slice(0, 27)}`;
  const key = process.env.LINE_CONFIG_ENC_KEY;
  if (!key) throw new Error("測試需要 LINE_CONFIG_ENC_KEY");
  const botId = await withSystemTx(async (tx) => {
    const r = await tx.execute<{ bot_id: string }>(sql`
      INSERT INTO line_bot (tenant_id, name, bot_user_id, kind, channel_secret_enc, channel_access_token_enc, status)
      VALUES (NULL, '通用ID bot(測試)', ${botUserId}, 'utility',
              pgp_sym_encrypt(${SECRET}, ${key}), pgp_sym_encrypt('token', ${key}), 'active')
      RETURNING bot_id::text
    `);
    return r.rows[0].bot_id;
  });
  return { botId, botUserId };
}

const dropBot = (botId: string) =>
  withSystemTx((tx) => tx.execute(sql`DELETE FROM line_bot WHERE bot_id = ${botId}::uuid`));

const countGroups = (groupId: string) =>
  withSystemTx(async (tx) => {
    const r = await tx.execute<{ n: string }>(
      sql`SELECT COUNT(*)::text AS n FROM line_group WHERE group_id = ${groupId}`,
    );
    return Number(r.rows[0].n);
  });

// 建一個只捕捉 replyMessage 的假 LineApiClient；utility 分支不碰其他依賴，故其餘傳空 stub。
function buildService(replies: Array<{ replyToken: string; text: string }>) {
  const lineApi = {
    replyMessage: async (_token: string, replyToken: string, messages: Array<{ text?: string }>) => {
      replies.push({ replyToken, text: messages.map((m) => m.text ?? "").join("\n") });
    },
  } as unknown as ConstructorParameters<typeof LineWebhookService>[6];
  const stub = {} as never;
  return new LineWebhookService(
    new LineBotRepository(),
    new LineGroupRepository(),
    stub, stub, stub, stub,
    lineApi,
    stub, stub, stub,
  );
}

function signedBody(botUserId: string, events: unknown[]): { body: string; sig: string } {
  const body = JSON.stringify({ destination: botUserId, events });
  const sig = createHmac("sha256", SECRET).update(body).digest("base64");
  return { body, sig };
}

test("⭐ P0 · 通用 bot 收 join → 回群組 ID，且不建 line_group（無落庫路徑）", async () => {
  const { botId, botUserId } = await seedUtilityBot();
  const groupId = `Cutil${randomUUID().replace(/-/g, "").slice(0, 27)}`;
  const replies: Array<{ replyToken: string; text: string }> = [];
  try {
    const svc = buildService(replies);
    const { body, sig } = signedBody(botUserId, [
      { type: "join", timestamp: Date.now(), replyToken: "rt-join", source: { type: "group", groupId } },
    ]);
    await svc.processWebhook(body, sig);

    assert.equal(replies.length, 1, "join 應觸發一則回覆");
    assert.ok(replies[0].text.includes(groupId), "回覆內文要含該群 ID");
    assert.equal(await countGroups(groupId), 0, "P0：通用 bot 絕不可 upsert line_group");
  } finally { await dropBot(botId); }
});

test("通用 bot 收「群組ID」關鍵字 → 回 ID；一般訊息 → 不回、不落庫", async () => {
  const { botId, botUserId } = await seedUtilityBot();
  const groupId = `Cutil${randomUUID().replace(/-/g, "").slice(0, 27)}`;
  const replies: Array<{ replyToken: string; text: string }> = [];
  try {
    const svc = buildService(replies);

    // 一般閒聊 → 不回
    const chat = signedBody(botUserId, [
      { type: "message", timestamp: Date.now(), replyToken: "rt-chat",
        source: { type: "group", groupId }, message: { id: "m1", type: "text", text: "今天天氣不錯" } },
    ]);
    await svc.processWebhook(chat.body, chat.sig);
    assert.equal(replies.length, 0, "非關鍵字訊息不應回覆");

    // 關鍵字 → 回 ID（用不同 group 避開 30s 去重）
    const groupId2 = `Cutil${randomUUID().replace(/-/g, "").slice(0, 27)}`;
    const kw = signedBody(botUserId, [
      { type: "message", timestamp: Date.now(), replyToken: "rt-kw",
        source: { type: "group", groupId: groupId2 }, message: { id: "m2", type: "text", text: " 群組ID " } },
    ]);
    await svc.processWebhook(kw.body, kw.sig);
    assert.equal(replies.length, 1, "關鍵字應觸發回覆");
    assert.ok(replies[0].text.includes(groupId2), "回覆要含該群 ID");

    assert.equal(await countGroups(groupId), 0, "P0：一般訊息不可落 line_group");
    assert.equal(await countGroups(groupId2), 0, "P0：關鍵字訊息不可落 line_group");
  } finally { await dropBot(botId); }
});

test("同群 30 秒內重複觸發只回一次（降噪）", async () => {
  const { botId, botUserId } = await seedUtilityBot();
  const groupId = `Cutil${randomUUID().replace(/-/g, "").slice(0, 27)}`;
  const replies: Array<{ replyToken: string; text: string }> = [];
  try {
    const svc = buildService(replies);
    const ts = Date.now();
    const first = signedBody(botUserId, [
      { type: "message", timestamp: ts, replyToken: "rt-1",
        source: { type: "group", groupId }, message: { id: "m1", type: "text", text: "群組ID" } },
    ]);
    await svc.processWebhook(first.body, first.sig);
    const second = signedBody(botUserId, [
      { type: "message", timestamp: ts + 5000, replyToken: "rt-2",
        source: { type: "group", groupId }, message: { id: "m2", type: "text", text: "群組ID" } },
    ]);
    await svc.processWebhook(second.body, second.sig);
    assert.equal(replies.length, 1, "5 秒內重複只回一次");
  } finally { await dropBot(botId); }
});
