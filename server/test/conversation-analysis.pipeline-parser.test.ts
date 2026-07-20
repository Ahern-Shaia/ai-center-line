// Unit tests: backend copy of parser · 對照 samples/ 檔案確保訊息數、分段數對得上 root src 版本
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseLineExport, segmentMessages } from "../src/conversation-analysis/pipeline/parser.js";

const SAMPLES_DIR = path.resolve(process.cwd(), "..", "samples");

test("parser: 台灣福祉-改裝群.txt 應解析 35 訊息（0..34 · 34 seq）· 2 天分兩段", () => {
  const raw = fs.readFileSync(path.join(SAMPLES_DIR, "台灣福祉-改裝群.txt"), "utf8");
  const { groupName, messages } = parseLineExport(raw);
  assert.equal(groupName, "台灣福祉-改裝報工群");
  assert.equal(messages.length, 35);
  const dates = new Set(messages.map((m) => m.date));
  assert.deepEqual([...dates].sort(), ["2026-07-02", "2026-07-03"]);
  const segments = segmentMessages(messages);
  assert.equal(segments.length, 2);
});

test("parser: 12h 上午/下午 → 24h 轉換", () => {
  const raw = `[LINE] test 的聊天記錄\n儲存日期：2026/01/01 00:00\n\n2026/01/01（一）\n上午12:30\t小明\thi\n下午12:30\t小明\tafternoon\n下午11:59\t小明\tnight\n`;
  const { messages } = parseLineExport(raw);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].time, "00:30"); // 上午 12 = 00
  assert.equal(messages[1].time, "12:30"); // 下午 12 = 12
  assert.equal(messages[2].time, "23:59"); // 下午 11 = 23
});

test("parser: 多行訊息續行併回前一則", () => {
  const raw = `[LINE] t 的聊天記錄\n2026/01/01（一）\n上午10:00\t阿明\t第一行\n續行內容\n上午10:05\t小華\t新訊息\n`;
  const { messages } = parseLineExport(raw);
  assert.equal(messages.length, 2);
  assert.match(messages[0].text, /^第一行\n續行內容$/);
  assert.equal(messages[1].text, "新訊息");
});

test("parser: 媒體訊息標記 kind=media", () => {
  const raw = `[LINE] t 的聊天記錄\n2026/01/01（一）\n上午10:00\t阿明\t[照片]\n上午10:01\t阿明\t[貼圖]\n上午10:02\t阿明\t normal text\n`;
  const { messages } = parseLineExport(raw);
  assert.equal(messages[0].kind, "media");
  assert.equal(messages[1].kind, "media");
  assert.equal(messages[2].kind, "text");
});

test("segment: maxSize 觸發跨天切分", () => {
  const messages = Array.from({ length: 150 }, (_, i) => ({
    id: i,
    date: i < 75 ? "2026-01-01" : "2026-01-02",
    time: "10:00",
    sender: "a",
    text: "x",
    kind: "text" as const,
  }));
  const segments = segmentMessages(messages, 60);
  // 75 訊息在 day1（>60、切 2 段）· 75 在 day2（>60、切 2 段）= 4 段
  assert.equal(segments.length, 4);
});
