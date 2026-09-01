// Unit tests：NotifyService 編排邏輯（用 fake LineClient + fake Repository，不摸 DB）
// M2 起 tenant-aware：handle 加 tenant 參數、白名單、dedup key 加 tenant prefix、audit tenantId
import { test } from "node:test";
import assert from "node:assert/strict";
import { NotifyService } from "../src/notify/notify.service.js";
import type { LinePushResult, LineTargetConfig } from "../src/notify/line.client.js";
import type { WriteLogInput } from "../src/notify/notify.repository.js";
import type { RagicMaintenanceReportPayload } from "../src/notify/dto/ragic-maintenance-report.dto.js";
import type { TenantConfig } from "../src/notify/tenant.registry.js";

class FakeLine {
  calls: Array<{ cfg: LineTargetConfig; text: string }> = [];
  constructor(private result: LinePushResult) {}
  async pushText(cfg: LineTargetConfig, text: string) {
    this.calls.push({ cfg, text });
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

const TWH: TenantConfig = {
  slug: "twh",
  displayName: "台灣福祉",
  webhookSecret: "s".repeat(32),
  lineChannelToken: "twh-token",
  lineGroupIdBusinessAssist: "twh-group",
  allowedSheetPaths: [], // 空 = 允許所有（back-compat）
};

const XIANYONG: TenantConfig = {
  slug: "xianyong",
  displayName: "鮮勇",
  webhookSecret: "x".repeat(32),
  lineChannelToken: "xy-token",
  lineGroupIdBusinessAssist: "xy-group",
  allowedSheetPaths: ["/quotation/6", "/material-inspection/4"],
};

const basePayload: RagicMaintenanceReportPayload = {
  trigger: "save",
  sheetPath: "/service-tickets/10",
  // ⚠️ 這個型別是 z.infer（schema 的 **輸出**）· sheetName 有 .default("")，
  //    所以 parse 完一定有值 —— 手工建的 payload 少了它就不是 prod 會看到的形狀。
  sheetName: "",
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

test("service: LINE 200 OK → status=sent、cfg 用 tenant token/group、audit 帶 tenantId", async () => {
  const line = new FakeLine({ ok: true, requestId: "line-req-1" });
  const repo = new FakeRepo();
  const svc = new NotifyService(line as any, repo as any);
  const res = await svc.handleMaintenanceReport(TWH, basePayload);
  assert.equal(res.status, "sent");
  assert.equal(repo.writes.length, 1);
  assert.equal(repo.writes[0].status, "sent");
  assert.equal(repo.writes[0].tenantId, "twh"); // audit 帶 tenantId
  assert.equal(repo.writes[0].sheetPath, "/service-tickets/10");
  assert.equal(repo.writes[0].recordId, 42);
  assert.ok(repo.writes[0].messageText?.includes("202607188-003"));
  assert.equal(line.calls.length, 1);
  assert.equal(line.calls[0].cfg.token, "twh-token"); // 用 tenant token
  assert.equal(line.calls[0].cfg.groupId, "twh-group"); // 用 tenant group
});

test("service: LINE 429 → status=line_failed、audit 帶 line_status + tenantId", async () => {
  const line = new FakeLine({ ok: false, status: 429, message: "Too Many Requests" });
  const repo = new FakeRepo();
  const svc = new NotifyService(line as any, repo as any);
  const res = await svc.handleMaintenanceReport(TWH, basePayload);
  assert.equal(res.status, "line_failed");
  assert.equal(res.lineStatus, 429);
  assert.equal(repo.writes.length, 1);
  assert.equal(repo.writes[0].status, "line_failed");
  assert.equal(repo.writes[0].lineStatus, 429);
  assert.equal(repo.writes[0].tenantId, "twh");
});

test("service: 同 record 30 秒內第 2 次 → status=skipped_dedup、不呼 LINE", async () => {
  const line = new FakeLine({ ok: true });
  const repo = new FakeRepo();
  const svc = new NotifyService(line as any, repo as any);
  await svc.handleMaintenanceReport(TWH, basePayload);
  const res2 = await svc.handleMaintenanceReport(TWH, basePayload);
  assert.equal(res2.status, "skipped_dedup");
  assert.equal(line.calls.length, 1); // 只被呼一次
  assert.equal(repo.writes.length, 2); // 兩次都寫 audit（第 2 次 status=skipped_dedup）
  assert.equal(repo.writes[1].status, "skipped_dedup");
  assert.equal(repo.writes[1].tenantId, "twh");
});

test("service: 不同 recordId 不 dedup、兩次都發", async () => {
  const line = new FakeLine({ ok: true });
  const repo = new FakeRepo();
  const svc = new NotifyService(line as any, repo as any);
  await svc.handleMaintenanceReport(TWH, basePayload);
  await svc.handleMaintenanceReport(TWH, { ...basePayload, recordId: 43 });
  assert.equal(line.calls.length, 2);
});

// M2 新增 tests

test("service: tenant twh 白名單空 → 任何 sheetPath 都允許（back-compat）", async () => {
  const line = new FakeLine({ ok: true });
  const repo = new FakeRepo();
  const svc = new NotifyService(line as any, repo as any);
  const res = await svc.handleMaintenanceReport(TWH, {
    ...basePayload,
    sheetPath: "/some/random-tab/999",
  });
  assert.equal(res.status, "sent");
});

test("service: tenant xianyong 非白名單 sheetPath → sheet_not_allowed，不呼 LINE", async () => {
  const line = new FakeLine({ ok: true });
  const repo = new FakeRepo();
  const svc = new NotifyService(line as any, repo as any);
  // 鮮勇白名單 = ['/quotation/6', '/material-inspection/4']；basePayload sheetPath 是 /service-tickets/10
  const res = await svc.handleMaintenanceReport(XIANYONG, basePayload);
  assert.equal(res.status, "sheet_not_allowed");
  assert.equal(line.calls.length, 0);
  assert.equal(repo.writes.length, 1);
  assert.equal(repo.writes[0].status, "sheet_not_allowed");
  assert.equal(repo.writes[0].tenantId, "xianyong");
});

test("service: tenant xianyong 白名單內 sheetPath → 允許，用 xy 的 token/group", async () => {
  const line = new FakeLine({ ok: true });
  const repo = new FakeRepo();
  const svc = new NotifyService(line as any, repo as any);
  const res = await svc.handleMaintenanceReport(XIANYONG, {
    ...basePayload,
    sheetPath: "/quotation/6",
  });
  assert.equal(res.status, "sent");
  assert.equal(line.calls[0].cfg.token, "xy-token");
  assert.equal(line.calls[0].cfg.groupId, "xy-group");
  assert.equal(repo.writes[0].tenantId, "xianyong");
});

test("service: cross-tenant 同 recordId 不 dedup（tenant A 送過、tenant B 仍發）", async () => {
  const line = new FakeLine({ ok: true });
  const repo = new FakeRepo();
  const svc = new NotifyService(line as any, repo as any);
  // twh 白名單空、任何 sheetPath 過；xianyong 需白名單內
  const payload = { ...basePayload, sheetPath: "/quotation/6" };
  await svc.handleMaintenanceReport(TWH, payload);
  const res2 = await svc.handleMaintenanceReport(XIANYONG, payload);
  // 兩 tenant 各自 dedup namespace → 都應該發
  assert.equal(res2.status, "sent");
  assert.equal(line.calls.length, 2);
  assert.equal(line.calls[0].cfg.token, "twh-token");
  assert.equal(line.calls[1].cfg.token, "xy-token");
});
