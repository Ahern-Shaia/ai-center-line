// Drizzle 型別化查詢層。權威 DDL＋RLS 在 migrations/0001_init.sql（drizzle-kit 不產 RLS）。
// 本檔須與該 SQL 保持同步。對應系統設計文件 §3（Phase 1 M1 子集）。
import {
  pgTable, uuid, text, timestamp, boolean, integer, bigserial, bigint, jsonb, numeric, date,
} from "drizzle-orm/pg-core";

export type Role = "aiproot_admin" | "consultant" | "tenant_admin" | "group_owner" | "employee";

export const tenants = pgTable("tenants", {
  tenantId: uuid("tenant_id").primaryKey().defaultRandom(),
  tenantName: text("tenant_name").notNull(),
  industry: text("industry"),
  onboardStatus: text("onboard_status").notNull().default("洽談中")
    .$type<"洽談中" | "測試中" | "正式上線" | "暫停">(),
  batchEnabled: boolean("batch_enabled").notNull().default(true),   // 0014 加 · cron 是否掃該 tenant
  extractionTemplate: text("extraction_template").notNull().default("factory_report"),   // 0030 · L2 業種模板
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
  // 0035 · uuid[] → text[]：LINE 的 message id 是字串不是 uuid
  // （宣告成 uuid[] 正是這欄從沒被寫過的原因之一）
  sourceMessageIds: text("source_message_ids").array(),
  messageCount: integer("message_count"),
  // 0036 · 第四條軸 · 擁有者是當責人本人（前三條分別是 AI／主管／歸屬）
  // ⚠️ AI 永遠不得寫 work_*；materializer 重跑也不覆寫
  workStatus: text("work_status").notNull().default("open").$type<"open" | "closed">(),
  workOutcome: text("work_outcome").$type<"完成" | "不用做了" | "轉他人" | "做不到">(),
  workClosedBy: uuid("work_closed_by").references(() => users.userId),   // 常為 null（當責人多半沒帳號）
  workClosedAt: timestamp("work_closed_at", { withTimezone: true }),
  workNote: text("work_note"),
  workClosedVia: text("work_closed_via").$type<"line_reply" | "web" | "system">(),
  workClosedLineUserId: text("work_closed_line_user_id"),                // 這欄才是一定有值的身分
  workClosedMessageId: text("work_closed_message_id"),
  workLastReportAt: timestamp("work_last_report_at", { withTimezone: true }),
  workLastReportNote: text("work_last_report_note"),
  workAskedAt: timestamp("work_asked_at", { withTimezone: true }),
  workAskedMessageId: text("work_asked_message_id"),
  // 0017 · warroom-task-board
  assigneeDisplayName: text("assignee_display_name"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  sourceUploadId: bigint("source_upload_id", { mode: "number" }),
  sourceRecordIndex: integer("source_record_index"),
  categoryId: uuid("category_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// 0017 · warroom-task-board · tenant-scoped 分類詞庫
export const categoryRegistry = pgTable("category_registry", {
  categoryId: uuid("category_id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  categoryName: text("category_name").notNull(),
  categorySlug: text("category_slug").notNull(),
  description: text("description"),
  usageCount: integer("usage_count").notNull().default(0),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.userId),
  status: text("status").notNull().default("active")
    .$type<"active" | "archived" | "pending_review">(),
});

// 0018 · personal-daily-report · 員工每日私訊 → AI 整理成日報
export const personalDailyReport = pgTable("personal_daily_report", {
  reportId: uuid("report_id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  reportDate: date("report_date").notNull(),
  uploadId: bigint("upload_id", { mode: "number" }),
  aiItems: jsonb("ai_items").notNull().default([]),
  finalItems: jsonb("final_items"),
  messageCount: integer("message_count").notNull().default(0),
  status: text("status").notNull().default("draft")
    .$type<"draft" | "confirmed" | "sent" | "empty" | "failed">(),
  aiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  errorMessage: text("error_message"),
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
  // 0035 · 這批 blob 逐行對應的 line_message.message_id（順序即 parser 編出來的號碼）
  // records[].source_ids 存的是索引，靠這份對照表翻回真實訊息
  sourceMessageIds: text("source_message_ids").array(),               // manual 上傳 = null（沒有對應來源）
});

export const analysisResult = pgTable("analysis_result", {
  uploadId: bigint("upload_id", { mode: "number" }).primaryKey().references(() => analysisUpload.id, { onDelete: "cascade" }),
  messages: jsonb("messages").notNull().default([]).$type<unknown[]>(),
  dailyReports: jsonb("daily_reports").notNull().default([]).$type<unknown[]>(),
  records: jsonb("records").notNull().default([]).$type<unknown[]>(),
  serviceReports: jsonb("service_reports").notNull().default([]).$type<unknown[]>(),
  extractionTemplate: text("extraction_template"),   // null = 0030 前舊資料 ≡ factory_report
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

// 0016 · employee-line-binding · 方向 8 LIFF Zero-Config
export const userLineBinding = pgTable("user_line_binding", {
  bindingId: uuid("binding_id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  botId: uuid("bot_id").notNull().references(() => lineBot.botId, { onDelete: "cascade" }),
  lineUserId: text("line_user_id").notNull(),                          // LINE UserId (Uxxx) · 對此 bot 唯一
  boundAt: timestamp("bound_at", { withTimezone: true }).notNull().defaultNow(),
  boundBy: uuid("bound_by").references(() => users.userId),
  bindingMethod: text("binding_method").notNull()
    .$type<"liff_self_service" | "aiproot_manual">(),
  status: text("status").notNull().default("active")
    .$type<"active" | "revoked">(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: uuid("revoked_by").references(() => users.userId),
  revokedReason: text("revoked_reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

// 外勤定位打卡 · migration 0023（docs/modules/attendance-location-mileage.md）
export const attendancePunch = pgTable("attendance_punch", {
  punchId: uuid("punch_id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  punchType: text("punch_type").$type<"clock_in" | "arrive_site" | "clock_out">().notNull(),
  lat: numeric("lat"),
  lng: numeric("lng"),
  accuracyM: numeric("accuracy_m"),
  customerName: text("customer_name"),
  source: text("source").$type<"liff_geo" | "location_msg" | "manual">().notNull().default("liff_geo"),
  photoMediaId: uuid("photo_media_id"),
  suspicious: jsonb("suspicious").$type<Record<string, unknown>>(),
  address: text("address"),                                          // 反向地理編碼結果（背景補）· migration 0025
  geocodedAt: timestamp("geocoded_at", { withTimezone: true }),
  punchedAt: timestamp("punched_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attendanceTrip = pgTable("attendance_trip", {
  tripId: uuid("trip_id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  fromPunchId: uuid("from_punch_id").notNull().references(() => attendancePunch.punchId, { onDelete: "cascade" }),
  toPunchId: uuid("to_punch_id").notNull().references(() => attendancePunch.punchId, { onDelete: "cascade" }),
  distanceM: integer("distance_m"),
  routeProvider: text("route_provider"),
  routeGeometry: text("route_geometry"),                             // encoded polyline（道路折線）· migration 0025
  straightDistanceM: integer("straight_distance_m"),                 // haversine 直線距離對照
  computedAt: timestamp("computed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 里程申訴（員工回報里程有誤 → 主管複核）· migration 0025
export const attendanceMileageDispute = pgTable("attendance_mileage_dispute", {
  disputeId: uuid("dispute_id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  tripId: uuid("trip_id").references(() => attendanceTrip.tripId, { onDelete: "set null" }),
  reportDate: date("report_date").notNull(),
  reason: text("reason").notNull(),
  status: text("status").$type<"pending" | "reviewing" | "resolved" | "rejected">().notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedBy: uuid("reviewed_by").references(() => users.userId, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  resolution: text("resolution"),
});

// 地圖路線 provider 平台設定（aiproot 全域）· migration 0024 · tile 欄位 0025
export const mapRoutingConfig = pgTable("map_routing_config", {
  singleton: boolean("singleton").primaryKey().default(true),
  provider: text("provider").$type<"openrouteservice" | "google_routes">().notNull().default("openrouteservice"),
  tileProvider: text("tile_provider").notNull().default("osm"),
  updatedBy: uuid("updated_by").references(() => users.userId, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// notify v2 自助設定平台（config-driven）· migration 0026
export const ragicAccount = pgTable("ragic_account", {
  accountId: uuid("account_id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.tenantId, { onDelete: "cascade" }),
  server: text("server").notNull().default("www"),
  apname: text("apname").notNull(),
  displayName: text("display_name").notNull(),
  createdBy: uuid("created_by").references(() => users.userId, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface NotifyConfigField {
  fieldId: number;
  label: string;
  order: number;
}

// 通知中心 v3（notification-hub）· migration 0027 · 來源/管道可插拔
export type NotificationSourceType = "ragic_form" | "internal_event" | "schedule";
export type NotificationChannelType = "line_group" | "line_user" | "email" | "in_app";

export interface NotificationTemplateItem { path: string; label: string; order: number }
export interface NotificationTemplate { title: string; items: NotificationTemplateItem[] }

export const notificationRule = pgTable("notification_rule", {
  ruleId: uuid("rule_id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.tenantId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  sourceType: text("source_type").$type<NotificationSourceType>().notNull(),
  sourceConfig: jsonb("source_config").$type<Record<string, unknown>>().notNull().default({}),
  webhookToken: text("webhook_token").unique(),
  template: jsonb("template").$type<NotificationTemplate>().notNull(),
  channelType: text("channel_type").$type<NotificationChannelType>().notNull(),
  channelTarget: text("channel_target"),
  createdBy: uuid("created_by").references(() => users.userId, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// v2（保留作遷移對帳 · v3 穩定後另開 migration 清除）
export const notifyConfig = pgTable("notify_config", {
  configId: uuid("config_id").primaryKey().defaultRandom(),
  ragicAccountId: uuid("ragic_account_id").notNull().references(() => ragicAccount.accountId, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").references(() => tenants.tenantId, { onDelete: "cascade" }),
  sheetPath: text("sheet_path").notNull(),
  sheetName: text("sheet_name").notNull(),
  webhookToken: text("webhook_token").notNull().unique(),
  title: text("title"),
  fields: jsonb("fields").$type<NotifyConfigField[]>().notNull().default([]),
  notifyCreate: boolean("notify_create").notNull().default(true),
  notifyUpdate: boolean("notify_update").notNull().default(true),
  notifyDelete: boolean("notify_delete").notNull().default(false),
  lineGroupId: text("line_group_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.userId, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// 0036 · 完成訊號先落地、後對應（docs/modules/task-completion-tracking.md §2.6）
//
// ⚠️ 存在的理由是**時序**：完成回覆即時進來，任務每天批次才產生。
// prod 真實案例 —— 07/27 21:28 指派、21:39 回「已設定」，
// 但分析要到 07/28 18:00 才跑到，完成訊號比任務早 21 小時。
// 寫成「收到回覆→找任務→關掉」的話當下一定找不到，訊號全部掉在地上。
export const pendingCompletionSignal = pgTable("pending_completion_signal", {
  signalId: uuid("signal_id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.tenantId, { onDelete: "cascade" }),
  groupId: text("group_id").notNull(),
  replyMessageId: text("reply_message_id").notNull(),
  quotedMessageId: text("quoted_message_id").notNull(),      // 對應的鑰匙
  replierLineUserId: text("replier_line_user_id").notNull(), // 身分自帶 · 不需要系統帳號
  replierDisplayName: text("replier_display_name"),
  intent: text("intent").notNull()
    .$type<"completion" | "progress" | "asked" | "answered_done" | "answered_not_yet">(),
  note: text("note"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedTicketId: uuid("resolved_ticket_id"),
  // ⚠️ 未消化 ≠ no_match：前者是批次還沒輪到（不是問題），
  //    後者是跑過了仍對不上（才是材料化漏接，才可拿去校準門檻）
  resolution: text("resolution").$type<"closed_ticket" | "created_ticket" | "no_match" | "superseded">(),
});
