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
import { buildAnalysisSchema, DEFAULT_CATEGORIES } from "../src/conversation-analysis/pipeline/schemas.js";
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

test("⭐ 可選用的 L2 模板必須有 trackedFields（否則健康度頁一片空白而非示警）", () => {
  // 2026-07-30 · service_order 開放選用（OQ-ESO-1 已用 prod 真實資料回答）時立的紀律：
  // 有 resultKey 卻沒 trackedFields 的模板，抽取健康度算不出任何 fieldFill，
  // 畫面看起來跟「一切正常」一樣 —— 模板選錯不會被抓到。
  // （general 沒有 resultKey，本來就不該有 trackedFields，不在此列。）
  for (const [name, t] of Object.entries(TEMPLATE_REGISTRY)) {
    if (!t.selectable || !t.resultKey) continue;
    assert.ok(t.trackedFields.length > 0, `模板「${name}」開放選用但沒有 trackedFields`);
  }
});

test("resolveTemplate · 未知值/null 一律回 default（不因設定缺失改變抽取行為）", () => {
  assert.equal(resolveTemplate(null), DEFAULT_TEMPLATE);
  assert.equal(resolveTemplate("不存在的模板"), DEFAULT_TEMPLATE);
  assert.equal(DEFAULT_TEMPLATE, "factory_report", "default 必須＝現行行為");
  assert.equal(resolveTemplate("general"), "general");
});

// ── 2026-07-30 · 分類定義與 L2 欄位的同步紀律 ──────────────────────
//
// 這一組釘的是「改了 A 卻忘記改 B」那類錯，今天各踩過一次：
//   ① schema 加了 items[].vehicle/status/warranty，但 prompt 沒說怎麼填
//   ② vehicle 移到 items[] 之後 trackedFields 還留著它 → 健康度永遠 0%（量錯地方）
//   ③ CategoryEnum 加了類別，但 prompt 的判別軸沒跟著寫

test("⭐⭐ service_order 的 prompt 必須交代三個新項目欄位怎麼填", () => {
  const f = TEMPLATE_REGISTRY.service_order.promptFragment;
  for (const must of [
    "items[].status",      // 項目層狀態
    "items[].vehicle",     // 車型在項目層
    "items[].warranty",    // 保內／保外
    "禁止自行判斷",         // 保固不可推測（R11）
  ]) {
    assert.ok(f.includes(must), `promptFragment 少了「${must}」的說明 —— schema 有欄位但沒教模型怎麼填`);
  }
});

test("⭐⭐ trackedFields 只能放 record 層欄位（健康度量不到 items 內層）", () => {
  // fieldFill 是 jsonb_array_elements(service_reports) item → item->>field，
  // 只看得到 record 層。放 item 層欄位進去會永遠顯示 0%，
  // 而那是量錯地方不是抽不到 —— 會讓人去修一個沒壞的東西。
  const ITEM_LEVEL = ["vehicle", "warranty", "amount", "qty", "name"];
  for (const t of Object.values(TEMPLATE_REGISTRY)) {
    for (const f of t.trackedFields) {
      assert.ok(!ITEM_LEVEL.includes(f), `trackedFields 不可含 item 層欄位「${f}」`);
    }
  }
});

test("⭐⭐ 每個建議分類都要在 tenant prompt 裡有定義", () => {
  // 只加 enum 不寫定義，模型不知道那一類是什麼，會空著或亂塞。
  for (const c of DEFAULT_CATEGORIES) {
    assert.ok(
      TWH_TENANT.systemPrompt.includes(`- ${c} `),
      `分類「${c}」在 CategoryEnum 裡但 tenant prompt 沒有定義它`,
    );
  }
});

test("⭐ 易混淆的分類對必須有明寫的判別軸", () => {
  // 加類別最常見的失敗是「清單加了、邊界沒講」，模型就在邊界上亂猜。
  const p = TWH_TENANT.systemPrompt;
  assert.ok(p.includes("錢的方向"), "procurement / sales 需要判別軸（誰付錢給誰）");
  assert.ok(
    p.includes("辦公室系統") || p.includes("it_support。"),
    "maintenance / it_support 需要判別軸（車輛設備 vs 辦公室系統）",
  );
});
