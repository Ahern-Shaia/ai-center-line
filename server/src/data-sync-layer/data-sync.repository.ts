import { Injectable } from "@nestjs/common";
import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  dataSyncOrder,
  dataSyncCustomer,
  dataSyncContact,
  dataSyncLog,
  dataSyncWritebackQueue,
} from "../db/schema.js";
import type { OrderCanonical } from "./models/order.js";
import type { CustomerCanonical } from "./models/customer.js";
import type { ContactCanonical } from "./models/contact.js";

// data-sync-layer repository · CRUD for 5 tables
// 對應 docs/modules/data-sync-layer.md v0.2 §4-9
// 所有 method 接受 `tx: Db` 為第一參數（來自 withTenant · 帶 RLS 隔離）· 不用 currentTx（sync job 在 request scope 外）

export interface SyncLogInput {
  tenantId: string;
  connector: string;
  operation: "pull" | "push" | "backfill" | "shadow";
  entity: "order" | "customer" | "contact";
  recordsProcessed: number;
  errors: number;
  latencyMs: number;
  startedAt: Date;
  finishedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface WritebackInput {
  tenantId: string;
  connector: string;
  entity: "order" | "customer" | "contact";
  payload: Record<string, unknown>;
  nextRetryAt?: Date;
}

export interface WritebackItem {
  id: number;
  tenantId: string;
  connector: string;
  entity: "order" | "customer" | "contact";
  payload: Record<string, unknown>;
  status: "pending" | "retrying" | "synced" | "failed";
  attempts: number;
  lastError: string | null;
}

@Injectable()
export class DataSyncRepository {
  // === Upsert 三 entity ===
  // Unique target = (tenant_id, source_connector, source_record_id)

  async upsertOrders(tx: Db, orders: OrderCanonical[]): Promise<number> {
    if (!orders.length) return 0;
    const rows = await tx
      .insert(dataSyncOrder)
      .values(
        orders.map((o) => ({
          tenantId: o.tenantId,
          sourceConnector: o.sourceConnector,
          sourceRecordId: o.sourceRecordId,
          sourceSheetPath: o.sourceSheetPath ?? null,
          orderNo: o.orderNo,
          customerName: o.customerName ?? null,
          orderDate: o.orderDate ?? null,
          expectedDeliveryDate: o.expectedDeliveryDate ?? null,
          status: o.status ?? null,
          amount: o.amount != null ? String(o.amount) : null,
          currency: o.currency,
          ownerName: o.ownerName ?? null,
          raw: o.raw,
          writeBackStatus: o.writeBackStatus,
        })),
      )
      .onConflictDoUpdate({
        target: [
          dataSyncOrder.tenantId,
          dataSyncOrder.sourceConnector,
          dataSyncOrder.sourceRecordId,
        ],
        set: {
          sourceSheetPath: sql`excluded.source_sheet_path`,
          orderNo: sql`excluded.order_no`,
          customerName: sql`excluded.customer_name`,
          orderDate: sql`excluded.order_date`,
          expectedDeliveryDate: sql`excluded.expected_delivery_date`,
          status: sql`excluded.status`,
          amount: sql`excluded.amount`,
          currency: sql`excluded.currency`,
          ownerName: sql`excluded.owner_name`,
          raw: sql`excluded.raw`,
          syncedAt: sql`now()`,
        },
      })
      .returning({ id: dataSyncOrder.id });
    return rows.length;
  }

  async upsertCustomers(tx: Db, customers: CustomerCanonical[]): Promise<number> {
    if (!customers.length) return 0;
    const rows = await tx
      .insert(dataSyncCustomer)
      .values(
        customers.map((c) => ({
          tenantId: c.tenantId,
          sourceConnector: c.sourceConnector,
          sourceRecordId: c.sourceRecordId,
          sourceSheetPath: c.sourceSheetPath ?? null,
          name: c.name,
          code: c.code ?? null,
          category: c.category ?? null,
          contactEmail: c.contactEmail ?? null,
          contactPhone: c.contactPhone ?? null,
          raw: c.raw,
        })),
      )
      .onConflictDoUpdate({
        target: [
          dataSyncCustomer.tenantId,
          dataSyncCustomer.sourceConnector,
          dataSyncCustomer.sourceRecordId,
        ],
        set: {
          sourceSheetPath: sql`excluded.source_sheet_path`,
          name: sql`excluded.name`,
          code: sql`excluded.code`,
          category: sql`excluded.category`,
          contactEmail: sql`excluded.contact_email`,
          contactPhone: sql`excluded.contact_phone`,
          raw: sql`excluded.raw`,
          syncedAt: sql`now()`,
        },
      })
      .returning({ id: dataSyncCustomer.id });
    return rows.length;
  }

  async upsertContacts(tx: Db, contacts: ContactCanonical[]): Promise<number> {
    if (!contacts.length) return 0;
    const rows = await tx
      .insert(dataSyncContact)
      .values(
        contacts.map((c) => ({
          tenantId: c.tenantId,
          sourceConnector: c.sourceConnector,
          sourceRecordId: c.sourceRecordId,
          customerId: c.customerId ?? null,
          name: c.name,
          title: c.title ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
          lineId: c.lineId ?? null,
          raw: c.raw,
        })),
      )
      .onConflictDoUpdate({
        target: [
          dataSyncContact.tenantId,
          dataSyncContact.sourceConnector,
          dataSyncContact.sourceRecordId,
        ],
        set: {
          customerId: sql`excluded.customer_id`,
          name: sql`excluded.name`,
          title: sql`excluded.title`,
          email: sql`excluded.email`,
          phone: sql`excluded.phone`,
          lineId: sql`excluded.line_id`,
          raw: sql`excluded.raw`,
          syncedAt: sql`now()`,
        },
      })
      .returning({ id: dataSyncContact.id });
    return rows.length;
  }

  // === Sync log ===

  async insertSyncLog(tx: Db, input: SyncLogInput): Promise<number> {
    const rows = await tx
      .insert(dataSyncLog)
      .values({
        tenantId: input.tenantId,
        connector: input.connector,
        operation: input.operation,
        entity: input.entity,
        recordsProcessed: input.recordsProcessed,
        errors: input.errors,
        latencyMs: input.latencyMs,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        metadata: input.metadata ?? {},
      })
      .returning({ id: dataSyncLog.id });
    return rows[0]?.id ?? 0;
  }

  // === Writeback queue ===

  async enqueueWriteback(tx: Db, input: WritebackInput): Promise<number> {
    const rows = await tx
      .insert(dataSyncWritebackQueue)
      .values({
        tenantId: input.tenantId,
        connector: input.connector,
        entity: input.entity,
        payload: input.payload,
        nextRetryAt: input.nextRetryAt ?? new Date(),
      })
      .returning({ id: dataSyncWritebackQueue.id });
    return rows[0]?.id ?? 0;
  }

  // Worker · 取 pending 到期的 · 用 raw db（跨 tenant scan · aiproot 語意）
  async getPendingWritebacks(db: Db, limit = 100): Promise<WritebackItem[]> {
    const rows = await db
      .select({
        id: dataSyncWritebackQueue.id,
        tenantId: dataSyncWritebackQueue.tenantId,
        connector: dataSyncWritebackQueue.connector,
        entity: dataSyncWritebackQueue.entity,
        payload: dataSyncWritebackQueue.payload,
        status: dataSyncWritebackQueue.status,
        attempts: dataSyncWritebackQueue.attempts,
        lastError: dataSyncWritebackQueue.lastError,
      })
      .from(dataSyncWritebackQueue)
      .where(
        and(
          sql`${dataSyncWritebackQueue.status} IN ('pending','retrying')`,
          lte(dataSyncWritebackQueue.nextRetryAt, new Date()),
        ),
      )
      .limit(limit);
    return rows.map((r) => ({
      ...r,
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }));
  }

  async markWritebackSynced(db: Db, id: number): Promise<void> {
    await db
      .update(dataSyncWritebackQueue)
      .set({ status: "synced", syncedAt: new Date() })
      .where(eq(dataSyncWritebackQueue.id, id));
  }

  async markWritebackFailed(
    db: Db,
    id: number,
    error: string,
    nextRetryAt: Date | null,
  ): Promise<void> {
    const status = nextRetryAt ? "retrying" : "failed";
    await db
      .update(dataSyncWritebackQueue)
      .set({
        status,
        attempts: sql`${dataSyncWritebackQueue.attempts} + 1`,
        lastError: error,
        nextRetryAt: nextRetryAt ?? new Date(),
      })
      .where(eq(dataSyncWritebackQueue.id, id));
  }
}
