// Unit tests：NotifyService 編排邏輯（用 fake LineClient + fake Repository，不摸 DB）
import { test } from "node:test";
import assert from "node:assert/strict";
import { NotifyService } from "../src/notify/notify.service.js";
import type { LinePushResult } from "../src/notify/line.client.js";
import type { WriteLogInput } from "../src/notify/notify.repository.js";
import type { RagicMaintenanceReportPayload } from "../src/notify/dto/ragic-maintenance-report.dto.js";

class FakeLine {
  calls: string[] = [];
  constructor(private result: LinePushResult) {}
  async pushText(text: string) {
    this.calls.push(text);
    return this.result;
  }
}

class FakeRepo {
  writes: WriteLogInput[] = [];
  async writeLog(input: WriteLogInput) {
    this.writes.push(input);
    return { id: this.writes.length, requestId: `req-${this.writes.length}` };
  }
}

const basePayload: RagicMaintenanceReportPayload = {
  trigger: "save",
  sheetPath: "/service-tickets/10",
  recordId: 42,
  record: {
    單據編號: "202607188-003",
    單據日期: "2026/07/07",
    來源別: "客戶申請",
    來源單據編號: "S-0001",
    車型: "SUV",
    車牌號碼: "uy7-098",
    車身號碼: "VIN-ABC-123",
    產品序號: "PROD-001",
    出廠日期: "2024/01/15",
    設備類型: "升降機",
    設備型號: "E-Series",
    設備序號: "EQ-556",
    維修保養狀況: "已完成",
    維修人員編號: "T161",
    維修人員姓名: "張澤志",
    經辦人員簽名: "李承辦",
  },
};

test("service: LINE 200 OK → status=sent、寫 audit log 一筆", async () => {
  const line = new FakeLine({ ok: true, requestId: "line-req-1" });
  const repo = new FakeRepo();
  const svc = new NotifyService(line as any, repo as any);
  const res = await svc.handleMaintenanceReport(basePayload);
  assert.equal(res.status, "sent");
  assert.equal(repo.writes.length, 1);
  assert.equal(repo.writes[0].status, "sent");
  assert.equal(repo.writes[0].sheetPath, "/service-tickets/10");
  assert.equal(repo.writes[0].recordId, 42);
  assert.ok(repo.writes[0].messageText?.includes("202607188-003"));
  assert.equal(line.calls.length, 1);
});

test("service: LINE 429 → status=line_failed、audit 帶 line_status", async () => {
  const line = new FakeLine({ ok: false, status: 429, message: "Too Many Requests" });
  const repo = new FakeRepo();
  const svc = new NotifyService(line as any, repo as any);
  const res = await svc.handleMaintenanceReport(basePayload);
  assert.equal(res.status, "line_failed");
  assert.equal(res.lineStatus, 429);
  assert.equal(repo.writes.length, 1);
  assert.equal(repo.writes[0].status, "line_failed");
  assert.equal(repo.writes[0].lineStatus, 429);
});

test("service: 同 record 30 秒內第 2 次 → status=skipped_dedup、不呼 LINE", async () => {
  const line = new FakeLine({ ok: true });
  const repo = new FakeRepo();
  const svc = new NotifyService(line as any, repo as any);
  await svc.handleMaintenanceReport(basePayload);
  const res2 = await svc.handleMaintenanceReport(basePayload);
  assert.equal(res2.status, "skipped_dedup");
  assert.equal(line.calls.length, 1); // 只被呼一次
  assert.equal(repo.writes.length, 2); // 兩次都寫 audit（第 2 次 status=skipped_dedup）
  assert.equal(repo.writes[1].status, "skipped_dedup");
});

test("service: 不同 recordId 不 dedup、兩次都發", async () => {
  const line = new FakeLine({ ok: true });
  const repo = new FakeRepo();
  const svc = new NotifyService(line as any, repo as any);
  await svc.handleMaintenanceReport(basePayload);
  await svc.handleMaintenanceReport({ ...basePayload, recordId: 43 });
  assert.equal(line.calls.length, 2);
});
