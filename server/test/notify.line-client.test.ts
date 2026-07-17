// Unit tests：LineClient — 注入假的 fetch 觀察行為。
// M2 起 stateless：pushText(cfg, text)；token/groupId 由 caller 傳入、不讀 env。
import { test } from "node:test";
import assert from "node:assert/strict";
import { LineClient, type LineTargetConfig } from "../src/notify/line.client.js";

const TWH_CFG: LineTargetConfig = { token: "twh-token", groupId: "twh-group" };
const XY_CFG: LineTargetConfig = { token: "xy-token", groupId: "xy-group" };

// 假 fetch 產生器
type FakeFetchOpts = { status: number; body?: unknown; requestId?: string; delayMs?: number; err?: Error };
function fakeFetch(opts: FakeFetchOpts): typeof fetch {
  return async (_url, _init) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.err) throw opts.err;
    const bodyStr = JSON.stringify(opts.body ?? {});
    const headers = new Headers();
    if (opts.requestId) headers.set("x-line-request-id", opts.requestId);
    return new Response(bodyStr, { status: opts.status, headers });
  };
}

test("line-client: 200 OK → ok=true 且拿到 x-line-request-id；使用傳入的 token/groupId", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const client = new LineClient();
  client.setFetchImpl(async (u, i) => {
    capturedUrl = String(u);
    capturedInit = i;
    return new Response("{}", { status: 200, headers: { "x-line-request-id": "req-xyz" } });
  });
  const res = await client.pushText(TWH_CFG, "hello");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.requestId, "req-xyz");
  assert.equal(capturedUrl, "https://api.line.me/v2/bot/message/push");
  assert.equal((capturedInit?.headers as Record<string, string>)["Authorization"], `Bearer ${TWH_CFG.token}`);
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.to, TWH_CFG.groupId);
  assert.equal(body.messages[0].text, "hello");
});

test("line-client: 不同 tenant 傳不同 cfg → token/group 隨之改變（不會混）", async () => {
  const captured: Array<{ auth: string; to: string }> = [];
  const client = new LineClient();
  client.setFetchImpl(async (_u, init) => {
    const headers = init?.headers as Record<string, string>;
    const body = JSON.parse(String(init?.body));
    captured.push({ auth: headers["Authorization"], to: body.to });
    return new Response("{}", { status: 200 });
  });
  await client.pushText(TWH_CFG, "a");
  await client.pushText(XY_CFG, "b");
  assert.deepEqual(captured, [
    { auth: `Bearer ${TWH_CFG.token}`, to: TWH_CFG.groupId },
    { auth: `Bearer ${XY_CFG.token}`, to: XY_CFG.groupId },
  ]);
});

test("line-client: 429 rate limit → ok=false status=429 帶 message", async () => {
  const client = new LineClient();
  client.setFetchImpl(fakeFetch({ status: 429, body: { message: "Too Many Requests" } }));
  const res = await client.pushText(TWH_CFG, "x");
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.status, 429);
    assert.match(res.message, /Too Many Requests/);
  }
});

test("line-client: 401 invalid token → ok=false status=401", async () => {
  const client = new LineClient();
  client.setFetchImpl(fakeFetch({ status: 401, body: { message: "Invalid channel access token" } }));
  const res = await client.pushText(TWH_CFG, "x");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 401);
});

test("line-client: 網路錯 → ok=false status=0 message 含 network", async () => {
  const client = new LineClient();
  client.setFetchImpl(fakeFetch({ status: 0, err: new Error("connect ECONNREFUSED") }));
  const res = await client.pushText(TWH_CFG, "x");
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.status, 0);
    assert.match(res.message, /network:/);
  }
});

test("line-client: cfg.token 空 → ok=false（不打真 API）", async () => {
  let fetchCalled = false;
  const client = new LineClient();
  client.setFetchImpl(async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  });
  const res = await client.pushText({ token: "", groupId: "g" }, "x");
  assert.equal(res.ok, false);
  assert.equal(fetchCalled, false);
});

test("line-client: cfg.groupId 空 → ok=false（不打真 API）", async () => {
  const client = new LineClient();
  client.setFetchImpl(async () => new Response("{}", { status: 200 }));
  const res = await client.pushText({ token: "t", groupId: "" }, "x");
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.message, /groupId/);
});
