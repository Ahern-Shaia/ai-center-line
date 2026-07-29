// ai-analysis-layering L1/L2 分層 · 對照 docs/modules/ai-analysis-layering.md
//
// ⚠️ 為什麼不是跑 samples/ 回歸（R12）：
//    `npm run analyze` 跑的是 CLI prototype（src/），本次改的是 server pipeline
//    （server/src/conversation-analysis/pipeline/）。兩份是各自獨立的 copy，
//    跑 CLI 會「通過」但完全沒驗到這次的改動 —— 那是假的綠燈。
//    真正的風險是「把 system prompt 拆成 base + 模板 fragment 時漏掉規則」，
//    以及「general 模板叫模型產出 schema 裡沒有的欄位」。這兩件都能靜態驗，
//    而且是永久防線（不需 API 費用、每次 CI 都跑）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnalysisSchema } from "../src/conversation-analysis/pipeline/schemas.js";
import { TEMPLATE_REGISTRY, EXTRACTION_TEMPLATES, resolveTemplate, DEFAULT_TEMPLATE } from "../src/conversation-analysis/pipeline/templates.js";
import { TWH_TENANT } from "../src/conversation-analysis/pipeline/tenant-twh.js";

const L1_FIXTURE = {
  classifications: [{ id: 1, category: "maintenance", confidence: "high" as const }],
  records: [{
    category: "maintenance", title: "鋼索更換", detail: "已換標準件",
    status: "resolved" as const, person: "P-02", machine_code: "ST-01",
    work_order: null, source_ids: [1], confidence: "high" as const,
  }],
};

// ── L1：所有模板都必須接受通用核心 ──────────────────────────────
test("L1 通用核心 · 每個模板都吃得下（不可關）", () => {
  for (const t of EXTRACTION_TEMPLATES) {
    const schema = buildAnalysisSchema(t);
    const def = TEMPLATE_REGISTRY[t];
    const input: Record<string, unknown> = { ...L1_FIXTURE };
    if (def.resultKey) input[def.resultKey] = [];
    assert.ok(schema.safeParse(input).success, `${t} 應接受 L1 核心`);
  }
});

// ── L2：模板決定有沒有業種區塊 ──────────────────────────────────
test("general · 沒有 L2 區塊（避免叫模型產出 schema 沒有的欄位）", () => {
  assert.equal(TEMPLATE_REGISTRY.general.resultKey, null);
  assert.equal(TEMPLATE_REGISTRY.general.promptFragment, "");
  const parsed = buildAnalysisSchema("general").parse(L1_FIXTURE) as Record<string, unknown>;
  assert.ok(!("daily_reports" in parsed));
  assert.ok(!("service_reports" in parsed));
});

test("factory_report · 保有 daily_reports 且欄位與改版前一致（compat）", () => {
  const schema = buildAnalysisSchema("factory_report");
  const ok = schema.safeParse({
    ...L1_FIXTURE,
    daily_reports: [{
      date: "2026-07-02", reporter_name: "王○○", reporter_code: "P-02", line: null,
      machine_code: "ST-01", work_order: "示範車號 A", output_qty: null, defect_qty: null,
      work_hours: 2.5, overtime_hours: null, issues: "鋼索已換", source_ids: [3], confidence: "high",
    }],
  });
  assert.ok(ok.success, "改版前的 daily_report 形狀必須仍然合法");
});

test("service_order · 一則多客戶 + 多項目，且**每個項目各有狀態**（prod 07-24 真實訊息）", () => {
  // 真實訊息（doc §3.4）：
  //   今日進度回報 / 嘉義中正高齡 / 辦公室 / 洽談側踏一台 / 待領料安裝 / 保養一台（3500）
  // ⚠️ 重點在「同一客戶、同一則回報，兩個項目狀態不同」——
  //    record 層只有一個 status 時會丟掉其中一個，這是 v0.2 把 status 下移到 items 的理由。
  const ok = buildAnalysisSchema("service_order").safeParse({
    ...L1_FIXTURE,
    service_reports: [{
      date: "2026-07-24", reporter: "志銓", customer: "嘉義中正高齡", site: "辦公室",
      items: [
        { name: "洽談側踏", qty: 1, amount: null,
          vehicle: null, status: "待領料安裝", warranty: null },
        { name: "保養", qty: 1, amount: 3500,
          vehicle: null, status: "完成", warranty: "保內" },
      ],
      status: null, issues: null, source_ids: [12], confidence: "high",
    }],
  });
  assert.ok(ok.success, ok.success ? "" : JSON.stringify(ok.error.issues.slice(0, 3)));
});

test("⭐ service_order · 車型在**項目層**（同一客戶多台不同車 · prod 07-27 真實訊息）", () => {
  // 真實訊息：高雄宜萃日照「旅玩家查修一台」/ 高雄林自用戶「凌厲斜坡板」
  // 車型綁在施作項目上 —— 放 record 層只記得一台。
  const ok = buildAnalysisSchema("service_order").safeParse({
    ...L1_FIXTURE,
    service_reports: [{
      date: "2026-07-27", reporter: "汪", customer: "高雄宜萃日照", site: null,
      items: [
        { name: "查修", qty: 1, amount: null, vehicle: "旅玩家", status: "待討論", warranty: "保內" },
        { name: "斜坡板止滑膠帶除膠", qty: 1, amount: null, vehicle: "JS", status: null, warranty: null },
      ],
      status: null, issues: null, source_ids: [7], confidence: "medium",
    }],
  });
  assert.ok(ok.success);
});

test("⭐⭐ service_order · 新增的三個項目欄位不可省略（必須明確給 null）", () => {
  // R11 紀律：缺漏一律填 null，不是省略 key。
  // 允許省略的話，模型會在「沒把握」時直接不輸出，我們就分不出
  // 「這個項目沒有保固資訊」與「模型忘了想這件事」。
  const missing = buildAnalysisSchema("service_order").safeParse({
    ...L1_FIXTURE,
    service_reports: [{
      date: "2026-07-24", reporter: null, customer: "X", site: null,
      items: [{ name: "保養", qty: 1, amount: null }],   // ← 少了 vehicle/status/warranty
      status: null, issues: null, source_ids: [1], confidence: "high",
    }],
  });
  assert.equal(missing.success, false, "省略新欄位應被 schema 擋下");
});

// ── prompt 拆分：不可在拆的過程中漏掉規則 ────────────────────────
test("拆 prompt 後 · factory_report 的完整指示仍在（base + fragment）", () => {
  const assembled = TWH_TENANT.systemPrompt + TEMPLATE_REGISTRY.factory_report.promptFragment;
  for (const must of [
    "daily_reports",            // L2 規則本身
    "machine_code",             // 工位對應
    "output_qty",               // 產量欄位規則
    "禁止臆測數字",              // R11
    "source_ids",               // 可溯源
    "confidence",               // 信心度分級
    "records",                  // L1 規則
  ]) {
    assert.ok(assembled.includes(must), `拆分後遺漏指示：${must}`);
  }
});

test("base prompt 不得殘留 L2 專屬指示（否則 general 會叫模型產出不存在的欄位）", () => {
  assert.ok(!TWH_TENANT.systemPrompt.includes("daily_reports"),
    "daily_reports 規則應只在 factory_report 模板的 fragment 內");
  assert.ok(!TWH_TENANT.systemPrompt.includes("output_qty"));
});

// ── 商業紀律與防呆 ──────────────────────────────────────────────
test("模板數量不得超過 5（OQ-AAL-3 · 防止退化成接案）", () => {
  assert.ok(EXTRACTION_TEMPLATES.length <= 5, "模板要能開垂直市場才做，見 doc §3");
});

test("service_order 尚未開放選用（欄位待客戶確認 · OQ-ESO-1）", () => {
  assert.equal(TEMPLATE_REGISTRY.service_order.selectable, false);
});

test("resolveTemplate · 未知值/null 一律回 default（不因設定缺失改變抽取行為）", () => {
  assert.equal(resolveTemplate(null), DEFAULT_TEMPLATE);
  assert.equal(resolveTemplate("不存在的模板"), DEFAULT_TEMPLATE);
  assert.equal(DEFAULT_TEMPLATE, "factory_report", "default 必須＝現行行為");
  assert.equal(resolveTemplate("general"), "general");
});
