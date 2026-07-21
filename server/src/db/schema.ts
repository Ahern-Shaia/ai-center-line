// Drizzle 型別化查詢層。權威 DDL＋RLS 在 migrations/0001_init.sql（drizzle-kit 不產 RLS）。
// 本檔須與該 SQL 保持同步。對應系統設計文件 §3（Phase 1 M1 子集）。
import {
  pgTable, uuid, text, timestamp, boolean, integer, bigserial, bigint, jsonb, numeric, date,
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
  // 密碼 policy (migration 0009 · tenant-provisioning M1)
  passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
  passwordExpiresAt: timestamp("password_expires_at", { withTimezone: true }),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const passwordHistory = pgTable("password_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
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

// LINE 對話分析 pilot（對應 docs/modules/conversation-analysis-pilot.md v0.3 §9.1 · migration 0005）
// Pilot Stage 1 · 不掛 RLS（Stage 2 才加）

export const analysisUpload = pgTable("analysis_upload", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.tenantId, { onDelete: "cascade" }),
  tenantSlug: text("tenant_slug").notNull(),
  filename: text("filename").notNull(),
  rawContent: text("raw_content").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.userId),     // batch (cron / aiproot manual) 為 null
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("pending")
    .$type<"pending" | "running" | "done" | "failed">(),
  errorMessage: text("error_message"),
  messageCount: integer("message_count"),
  segmentCount: integer("segment_count"),
  usageStats: jsonb("usage_stats").$type<Record<string, unknown>>(),
  source: text("source").notNull().default("manual")
    .$type<"manual" | "webhook" | "webhook_manual">(),               // 0013 加
  groupId: text("group_id"),                                          // 0013 加 · LINE groupId · manual = null
  batchDate: text("batch_date"),                                      // 0013 加 · date (postgres date · driver 回 string)
});

export const analysisResult = pgTable("analysis_result", {
  uploadId: bigint("upload_id", { mode: "number" }).primaryKey().references(() => analysisUpload.id, { onDelete: "cascade" }),
  messages: jsonb("messages").notNull().default([]).$type<unknown[]>(),
  dailyReports: jsonb("daily_reports").notNull().default([]).$type<unknown[]>(),
  records: jsonb("records").notNull().default([]).$type<unknown[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const analysisLabel = pgTable("analysis_label", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  uploadId: bigint("upload_id", { mode: "number" }).notNull().references(() => analysisUpload.id, { onDelete: "cascade" }),
  targetType: text("target_type").notNull()
    .$type<"classification" | "daily_report" | "record">(),
  targetId: text("target_id").notNull(),
  correct: boolean("correct").notNull(),
  note: text("note"),
  labeledBy: uuid("labeled_by").notNull().references(() => users.userId),
  labeledAt: timestamp("labeled_at", { withTimezone: true }).notNull().defaultNow(),
});

// 中介資料層 · Data Sync Layer（對應 docs/modules/data-sync-layer.md v0.2 · migration 0006）
// 5 表 · 全掛 tenant_id + RLS

export const dataSyncCustomer = pgTable("data_sync_customer", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  sourceConnector: text("source_connector").notNull()
    .$type<"ragic" | "weyver" | "sap" | "manual">(),
  sourceRecordId: text("source_record_id").notNull(),
  sourceSheetPath: text("source_sheet_path"),
  name: text("name").notNull(),
  code: text("code"),
  category: text("category"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  raw: jsonb("raw").notNull().default({}).$type<Record<string, unknown>>(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dataSyncOrder = pgTable("data_sync_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  sourceConnector: text("source_connector").notNull()
    .$type<"ragic" | "weyver" | "sap" | "manual">(),
  sourceRecordId: text("source_record_id").notNull(),
  sourceSheetPath: text("source_sheet_path"),
  orderNo: text("order_no").notNull(),
  customerName: text("customer_name"),
  orderDate: date("order_date"),
  expectedDeliveryDate: date("expected_delivery_date"),
  status: text("status"),
  amount: numeric("amount", { precision: 15, scale: 2 }),
  currency: text("currency").notNull().default("TWD"),
  ownerName: text("owner_name"),
  raw: jsonb("raw").notNull().default({}).$type<Record<string, unknown>>(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  writeBackStatus: text("write_back_status").notNull().default("synced")
    .$type<"synced" | "pending" | "failed">(),
});

export const dataSyncContact = pgTable("data_sync_contact", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  sourceConnector: text("source_connector").notNull()
    .$type<"ragic" | "weyver" | "sap" | "manual">(),
  sourceRecordId: text("source_record_id").notNull(),
  customerId: uuid("customer_id").references(() => dataSyncCustomer.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  title: text("title"),
  email: text("email"),
  phone: text("phone"),
  lineId: text("line_id"),
  raw: jsonb("raw").notNull().default({}).$type<Record<string, unknown>>(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dataSyncLog = pgTable("data_sync_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  connector: text("connector").notNull(),
  operation: text("operation").notNull()
    .$type<"pull" | "push" | "backfill" | "shadow">(),
  entity: text("entity").notNull()
    .$type<"order" | "customer" | "contact">(),
  recordsProcessed: integer("records_processed").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
});

// Tenant LLM 設定 · 對應 migration 0007
// api_key_enc 是 pgcrypto AES-256 加密 · drizzle 走 raw sql 讀寫（見 llm-config.service）
export const tenantLlmConfig = pgTable("tenant_llm_config", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.tenantId, { onDelete: "cascade" }),
  provider: text("provider").notNull()
    .$type<"anthropic" | "openai" | "google" | "ollama" | "deepseek">(),
  model: text("model").notNull(),
  baseUrl: text("base_url"),
  temperature: numeric("temperature", { precision: 3, scale: 2 }),
  maxTokens: integer("max_tokens"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.userId),
});

export const dataSyncWritebackQueue = pgTable("data_sync_writeback_queue", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  connector: text("connector").notNull(),
  entity: text("entity").notNull()
    .$type<"order" | "customer" | "contact">(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  status: text("status").notNull().default("pending")
    .$type<"pending" | "retrying" | "synced" | "failed">(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});

// ============================================================
// LINE Bot / Group Registry（line-ingest module · migration 0008）
// 對應 docs/modules/line-ingest.md v0.1 §3
// ============================================================

export const lineBot = pgTable("line_bot", {
  botId: uuid("bot_id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  botUserId: text("bot_user_id").notNull(),                    // webhook destination lookup (Uxxx)
  channelId: text("channel_id"),                                // LINE Console numeric id · optional
  // channel_secret_enc / channel_access_token_enc 為 bytea · Drizzle 不直接處理 · 走 raw sql
  status: text("status").notNull().default("active").$type<"active" | "disabled">(),
  webhookVerifiedAt: timestamp("webhook_verified_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.userId),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lineGroup = pgTable("line_group", {
  groupRegistryId: uuid("group_registry_id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => lineBot.botId, { onDelete: "cascade" }),
  groupId: text("group_id").notNull(),                          // LINE Cxxx...
  displayName: text("display_name"),
  departmentId: uuid("department_id").references(() => departments.departmentId, { onDelete: "set null" }),
  analyzeEnabled: boolean("analyze_enabled").notNull().default(false),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull().defaultNow(),
  eventCount: integer("event_count").notNull().default(0),
  status: text("status").notNull().default("active").$type<"active" | "left">(),
  lastEventRaw: jsonb("last_event_raw").$type<Record<string, unknown> | null>(),
});

// ============================================================
// Permission Engine (migration 0010 · permission-engine M1)
// ============================================================
export const permissions = pgTable("permissions", {
  permissionId: text("permission_id").primaryKey(),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  description: text("description").notNull(),
  scope: text("scope").notNull().default("tenant").$type<"platform" | "tenant" | "department">(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable("roles", {
  roleId: uuid("role_id").primaryKey().defaultRandom(),
  roleKey: text("role_key").notNull(),
  roleName: text("role_name").notNull(),
  tenantId: uuid("tenant_id").references(() => tenants.tenantId, { onDelete: "cascade" }),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").notNull().references(() => roles.roleId, { onDelete: "cascade" }),
  permissionId: text("permission_id").notNull().references(() => permissions.permissionId, { onDelete: "cascade" }),
});
