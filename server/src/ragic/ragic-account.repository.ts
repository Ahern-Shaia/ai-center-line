import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

// ragic_account CRUD · api_key 用 pgcrypto 加密（key = LINE_CONFIG_ENC_KEY · 沿用既有設定）
export interface RagicAccountRow {
  accountId: string;
  tenantId: string | null;
  server: string;
  apname: string;
  displayName: string;
  hasKey: boolean;
}

@Injectable()
export class RagicAccountRepository {
  private encKey(): string {
    const k = process.env.LINE_CONFIG_ENC_KEY;
    if (!k) throw new Error("LINE_CONFIG_ENC_KEY env 未設（Ragic API key 加密需要）");
    return k;
  }

  // 前端顯示用 · 不回 key 明碼
  /**
   * 某個租戶可用的帳號 · 主檔設定頁用。
   *
   * ⚠️ 一定要過濾。平台管理員會在「A 客戶」的頁面上操作，
   * 若把所有租戶的帳號都列出來，他可能改到 B 家的金鑰而毫無察覺。
   * tenant_id IS NULL 的視為平台共用（早期資料就是這樣建的）。
   */
  async listForTenant(tx: Db, tenantId: string): Promise<RagicAccountRow[]> {
    const res = await tx.execute<{
      account_id: string; tenant_id: string | null; server: string; apname: string; display_name: string; has_key: boolean;
    }>(sql`
      SELECT account_id, tenant_id, server, apname, display_name, (api_key_enc IS NOT NULL) AS has_key
      FROM ragic_account
      WHERE tenant_id = ${tenantId}::uuid OR tenant_id IS NULL
      ORDER BY created_at DESC
    `);
    return res.rows.map((r) => ({
      accountId: r.account_id, tenantId: r.tenant_id, server: r.server,
      apname: r.apname, displayName: r.display_name, hasKey: r.has_key,
    }));
  }

  async list(tx: Db): Promise<RagicAccountRow[]> {
    const res = await tx.execute<{
      account_id: string; tenant_id: string | null; server: string; apname: string; display_name: string; has_key: boolean;
    }>(sql`
      SELECT account_id, tenant_id, server, apname, display_name, (api_key_enc IS NOT NULL) AS has_key
      FROM ragic_account ORDER BY created_at DESC
    `);
    return res.rows.map((r) => ({
      accountId: r.account_id, tenantId: r.tenant_id, server: r.server,
      apname: r.apname, displayName: r.display_name, hasKey: r.has_key,
    }));
  }

  async create(tx: Db, a: {
    tenantId: string | null; server: string; apname: string; displayName: string; apiKey: string | null; createdBy: string;
  }): Promise<{ accountId: string }> {
    const key = this.encKey();
    const encExpr = a.apiKey ? sql`pgp_sym_encrypt(${a.apiKey}, ${key})` : sql`NULL`;
    const res = await tx.execute<{ account_id: string }>(sql`
      INSERT INTO ragic_account (tenant_id, server, apname, display_name, api_key_enc, created_by)
      VALUES (${a.tenantId}, ${a.server}, ${a.apname}, ${a.displayName}, ${encExpr}, ${a.createdBy}::uuid)
      RETURNING account_id
    `);
    return { accountId: res.rows[0].account_id };
  }

  // 內部用 · 回明碼 key（呼 Ragic API 時）· 走 aiproot / system 上下文
  async getWithKey(tx: Db, accountId: string): Promise<{ server: string; apname: string; apiKey: string | null } | null> {
    const key = this.encKey();
    const res = await tx.execute<{ server: string; apname: string; api_key: string | null }>(sql`
      SELECT server, apname,
             CASE WHEN api_key_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(api_key_enc, ${key})::text END AS api_key
      FROM ragic_account WHERE account_id = ${accountId}::uuid LIMIT 1
    `);
    const r = res.rows[0];
    return r ? { server: r.server, apname: r.apname, apiKey: r.api_key } : null;
  }

  async updateKey(tx: Db, accountId: string, apiKey: string): Promise<void> {
    const key = this.encKey();
    await tx.execute(sql`
      UPDATE ragic_account SET api_key_enc = pgp_sym_encrypt(${apiKey}, ${key}), updated_at = now()
      WHERE account_id = ${accountId}::uuid
    `);
  }
}
