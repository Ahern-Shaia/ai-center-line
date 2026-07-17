// Drizzle 型別化查詢層。權威 DDL＋RLS 在 migrations/0001_init.sql（drizzle-kit 不產 RLS）。
// 本檔須與該 SQL 保持同步。對應系統設計文件 §3（Phase 1 M1 子集）。
import {
  pgTable, uuid, text, timestamp, boolean, integer, bigserial, jsonb,
} from "drizzle-orm/pg-core";

export type Role = "aiproot_admin" | "consultant" | "tenant_admin" | "group_owner";

export const tenants = pgTable("tenants", {
  tenantId: uuid("tenant_id").primaryKey().defaultRandom(),
  tenantName: text("tenant_name").notNull(),
  industry: text("industry"),
  onboardStatus: text("onboard_status").notNull().default("洽談中")
    .$type<"洽談中" | "測試中" | "正式上線" | "暫停">(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const departments = pgTable("departments", {
  departmentId: uuid("department_id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  departmentName: text("department_name").notNull(),
  displayName: text("display_name"),
  lineGroupId: text("line_group_id").notNull(),
  extractionSchema: text("extraction_schema").notNull(),
  ragicTable: text("ragic_table").notNull(),
});

export const users = pgTable("users", {
  userId: uuid("user_id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.tenantId, { onDelete: "cascade" }), // aiproot/consultant 為 NULL
  role: text("role").notNull().$type<Role>(),
  departmentId: uuid("department_id").references(() => departments.departmentId, { onDelete: "set null" }),
  lineUserId: text("line_user_id"),
  email: text("email"),
  displayName: text("display_name"), // 戰情室 UI 顯示用；為 null 時 fallback email prefix
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tickets = pgTable("tickets", {
  ticketId: uuid("ticket_id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  departmentId: uuid("department_id").notNull().references(() => departments.departmentId, { onDelete: "cascade" }),
  category: text("category"),
  summary: text("summary"),
  status: text("status"),
  confidence: text("confidence").$type<"high" | "medium" | "low">(),
  confirmStatus: text("confirm_status").notNull().default("待簽核")
    .$type<"待簽核" | "已簽核" | "逾時警示">(),
  confirmedBy: uuid("confirmed_by").references(() => users.userId),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  proxyBy: uuid("proxy_by").references(() => users.userId),
  needsReview: boolean("needs_review").notNull().default(false),
  syncStatusRagic: text("sync_status_ragic").notNull().default("未同步")
    .$type<"未同步" | "同步中" | "已同步" | "同步失敗">(),
  sourceMessageIds: uuid("source_message_ids").array(),
  messageCount: integer("message_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actorUserId: uuid("actor_user_id"),
  actorRole: text("actor_role"),
  action: text("action").notNull(),
  tenantId: uuid("tenant_id"),
  targetId: uuid("target_id"),
  result: text("result").notNull().default("allowed").$type<"allowed" | "denied">(),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Ragic → LINE 通知 audit（對應 docs/modules/notify.md §7.1 + notify-multi-tenant.md §7.1）
// M2 起 tenant_id text NOT NULL default 'twh'（存 slug；OQ-NMT-5 A）；未來多租戶 read API 再加 RLS
export const notificationLog = pgTable("notification_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  requestId: uuid("request_id").notNull().defaultRandom(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  trigger: text("trigger").notNull().$type<"save" | "button">(),
  sheetPath: text("sheet_path").notNull(),
  recordId: integer("record_id").notNull(),
  status: text("status").notNull()
    .$type<"sent" | "skipped_dedup" | "line_failed" | "invalid_body" | "invalid_secret" | "sheet_not_allowed">(),
  lineStatus: integer("line_status"),
  lineMessage: text("line_message"),
  latencyMs: integer("latency_ms").notNull(),
  messageText: text("message_text"),
  tenantId: text("tenant_id").notNull().default("twh"),
  audit: jsonb("audit").notNull().default({}).$type<Record<string, unknown>>(),
});
