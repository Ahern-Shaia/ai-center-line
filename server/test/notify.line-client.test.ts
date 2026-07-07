// Unit tests：LineClient — 注入假的 fetch 觀察行為。
import { test } from "node:test";
import assert from "node:assert/strict";
import { LineClient } from "../src/notify/line.client.js";

const TOKEN = "test-channel-token";
const GROUP_ID = "test-group-id";

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const cleanup = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const res = fn();
  if (res instanceof Promise) return res.finally(cleanup) as Promise<T>;
  cleanup();
  return Promise.resolve(res);
}

// 假 fetch 產生器
type FakeFetchOpts = { status: number; body?: unknown; requestId?: string; delayMs?: number; err?: Error };
function fakeFetch(opts: FakeFetchOpts): typeof fetch {
  return async (_url, init) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.err) throw opts.err;
    const bodyStr = JSON.stringify(opts.body ?? {});
    const headers = new Headers();
    if (opts.requestId) headers.set("x-line-request-id", opts.requestId);
    return new Response(bodyStr, { status: opts.status, headers });
  };
}

test("line-client: 200 OK → ok=true 且拿到 x-line-request-id", async () => {
  await withEnv({ LINE_CHANNEL_ACCESS_TOKEN: TOKEN, LINE_GROUP_ID_BUSINESS_ASSIST: GROUP_ID }, async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const client = new LineClient();
    client.setFetchImpl(async (u, i) => {
      capturedUrl = String(u);
      capturedInit = i;
      return new Response("{}", { status: 200, headers: { "x-line-request-id": "req-xyz" } });
    });
    const res = await client.pushText("hello");
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.requestId, "req-xyz");
    assert.equal(capturedUrl, "https://api.line.me/v2/bot/message/push");
    assert.equal((capturedInit?.headers as Record<string, string>)["Authorization"], `Bearer ${TOKEN}`);
    const body = JSON.parse(String(capturedInit?.body));
    assert.equal(body.to, GROUP_ID);
    assert.equal(body.messages[0].text, "hello");
  });
});

test("line-client: 429 rate limit → ok=false status=429 帶 message", async () => {
  await withEnv({ LINE_CHANNEL_ACCESS_TOKEN: TOKEN, LINE_GROUP_ID_BUSINESS_ASSIST: GROUP_ID }, async () => {
    const client = new LineClient(); client.setFetchImpl(fakeFetch({ status: 429, body: { message: "Too Many Requests" } }));
    const res = await client.pushText("x");
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.status, 429);
      assert.match(res.message, /Too Many Requests/);
    }
  });
});

test("line-client: 401 invalid token → ok=false status=401", async () => {
  await withEnv({ LINE_CHANNEL_ACCESS_TOKEN: TOKEN, LINE_GROUP_ID_BUSINESS_ASSIST: GROUP_ID }, async () => {
    const client = new LineClient(); client.setFetchImpl(fakeFetch({ status: 401, body: { message: "Invalid channel access token" } }));
    const res = await client.pushText("x");
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.status, 401);
  });
});

test("line-client: 網路錯 → ok=false status=0 message 含 network", async () => {
  await withEnv({ LINE_CHANNEL_ACCESS_TOKEN: TOKEN, LINE_GROUP_ID_BUSINESS_ASSIST: GROUP_ID }, async () => {
    const client = new LineClient(); client.setFetchImpl(fakeFetch({ status: 0, err: new Error("connect ECONNREFUSED") }));
    const res = await client.pushText("x");
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.status, 0);
      assert.match(res.message, /network:/);
    }
  });
});

test("line-client: env 缺 token → ok=false（不打真 API）", async () => {
  await withEnv({ LINE_CHANNEL_ACCESS_TOKEN: undefined, LINE_GROUP_ID_BUSINESS_ASSIST: GROUP_ID }, async () => {
    let fetchCalled = false;
    const client = new LineClient();
    client.setFetchImpl(async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    });
    const res = await client.pushText("x");
    assert.equal(res.ok, false);
    assert.equal(fetchCalled, false);
  });
});

test("line-client: env 缺 group id → ok=false（不打真 API）", async () => {
  await withEnv({ LINE_CHANNEL_ACCESS_TOKEN: TOKEN, LINE_GROUP_ID_BUSINESS_ASSIST: undefined }, async () => {
    const client = new LineClient();
    client.setFetchImpl(async () => new Response("{}", { status: 200 }));
    const res = await client.pushText("x");
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.message, /LINE_GROUP_ID_BUSINESS_ASSIST/);
  });
});
