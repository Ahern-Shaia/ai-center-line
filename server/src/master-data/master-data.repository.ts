import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

// 主檔來源設定與客戶主檔存取 · docs/modules/master-data-sync.md

export interface MasterDataSourceRow {
  sourceId: string;
  tenantId: string;
  kind: "customer";
  provider: "ragic" | "manual";
  accountId: string | null;
  sheetPath: string | null;
  nameField: string | null;
  codeField: string | null;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncCount: number | null;
  lastSyncError: string | null;
}

@Injectable()
export class MasterDataRepository {
  async getSource(tx: Db, tenantId: string, kind = "customer"): Promise<MasterDataSourceRow | null> {
    const r = await tx.execute<Record<string, unknown>>(sql`
      SELECT source_id::text, tenant_id::text, kind, provider, account_id::text,
             sheet_path, name_field, code_field, enabled,
             last_sync_at::text, last_sync_count, last_sync_error
        FROM master_data_source
       WHERE tenant_id = ${tenantId}::uuid AND kind = ${kind}
       LIMIT 1
    `);
    const row = r.rows[0];
    if (!row) return null;
    return {
      sourceId: row.source_id as string,
      tenantId: row.tenant_id as string,
      kind: row.kind as "customer",
      provider: row.provider as "ragic" | "manual",
      accountId: (row.account_id as string | null) ?? null,
      sheetPath: (row.sheet_path as string | null) ?? null,
      nameField: (row.name_field as string | null) ?? null,
      codeField: (row.code_field as string | null) ?? null,
      enabled: row.enabled as boolean,
      lastSyncAt: (row.last_sync_at as string | null) ?? null,
      lastSyncCount: (row.last_sync_count as number | null) ?? null,
      lastSyncError: (row.last_sync_error as string | null) ?? null,
    };
  }

  /** 一種主檔一個來源 · 靠 UNIQUE(tenant_id, kind) 撞則更新 */
  async upsertSource(tx: Db, a: {
    tenantId: string; kind: string; provider: string;
    accountId: string | null; sheetPath: string | null;
    nameField: string | null; codeField: string | null;
  }): Promise<void> {
    await tx.execute(sql`
      INSERT INTO master_data_source
        (tenant_id, kind, provider, account_id, sheet_path, name_field, code_field)
      VALUES (${a.tenantId}::uuid, ${a.kind}, ${a.provider}, ${a.accountId}::uuid,
              ${a.sheetPath}, ${a.nameField}, ${a.codeField})
      ON CONFLICT (tenant_id, kind) DO UPDATE SET
        provider = EXCLUDED.provider,
        account_id = EXCLUDED.account_id,
        sheet_path = EXCLUDED.sheet_path,
        name_field = EXCLUDED.name_field,
        code_field = EXCLUDED.code_field,
        updated_at = now()
    `);
  }

  async recordSyncResult(tx: Db, sourceId: string, count: number | null, error: string | null): Promise<void> {
    await tx.execute(sql`
      UPDATE master_data_source
         SET last_sync_at = now(), last_sync_count = ${count},
             last_sync_error = ${error}, updated_at = now()
       WHERE source_id = ${sourceId}::uuid
    `);
  }

  /**
   * 覆蓋式寫入客戶主檔。
   *
   * ⚠️ 不刪除來源已消失的客戶，改標 active=false（F-6）——
   * 歷史打卡還指著那個名字，刪掉會讓舊紀錄變成孤兒。
   */
  async replaceCustomers(tx: Db, tenantId: string, connector: string, rows: Array<{
    sourceRecordId: string; name: string; code: string | null; sheetPath: string | null;
  }>): Promise<number> {
    if (rows.length > 0) {
      for (const c of rows) {
        await tx.execute(sql`
          INSERT INTO data_sync_customer
            (tenant_id, source_connector, source_record_id, source_sheet_path, name, code, active, synced_at)
          VALUES (${tenantId}::uuid, ${connector}, ${c.sourceRecordId}, ${c.sheetPath},
                  ${c.name}, ${c.code}, true, now())
          ON CONFLICT (tenant_id, source_connector, source_record_id) DO UPDATE SET
            name = EXCLUDED.name, code = EXCLUDED.code,
            active = true, synced_at = now()
        `);
      }
    }
    // 這輪沒出現的 → 來源已刪 → 停用但保留。
    //
    // ⚠️ 用「這輪實際出現的 id」判斷，不用時間窗：交易內 now() 是固定的，
    //    拿 synced_at < now() - interval 來比對永遠不會成立。
    // ⚠️ 空結果一律不停用 —— 拉到 0 筆比較可能是 API 出問題，
    //    而不是客戶真的把整份名冊刪光。寧可留著舊的，也不要一次全部停用。
    if (rows.length > 0) {
      const ids = rows.map((r) => r.sourceRecordId).join(",");
      await tx.execute(sql`
        UPDATE data_sync_customer SET active = false
         WHERE tenant_id = ${tenantId}::uuid AND source_connector = ${connector}
           AND active
           AND NOT (source_record_id = ANY(string_to_array(${ids}, ',')))
      `);
    }
    return rows.length;
  }

  /** 客戶候選 · 打卡選單與 AI 候選集共用 */
  async searchCustomers(tx: Db, tenantId: string, q: string, limit = 20): Promise<Array<{ name: string; code: string | null }>> {
    const kw = q.trim();
    const r = await tx.execute<{ name: string; code: string | null }>(sql`
      SELECT name, code FROM data_sync_customer
       WHERE tenant_id = ${tenantId}::uuid AND active
         AND (${kw} = '' OR name ILIKE '%' || ${kw} || '%')
       ORDER BY name
       LIMIT ${limit}
    `);
    return r.rows.map((x) => ({ name: x.name, code: x.code }));
  }

  async countCustomers(tx: Db, tenantId: string): Promise<number> {
    const r = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM data_sync_customer
       WHERE tenant_id = ${tenantId}::uuid AND active
    `);
    return r.rows[0]?.n ?? 0;
  }
}
