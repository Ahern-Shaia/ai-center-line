import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { NotifyConfigField } from "../db/schema.js";

export interface NotifyConfigRow {
  configId: string;
  ragicAccountId: string;
  tenantId: string | null;
  sheetPath: string;
  sheetName: string;
  webhookToken: string;
  title: string | null;
  fields: NotifyConfigField[];
  notifyCreate: boolean;
  notifyUpdate: boolean;
  notifyDelete: boolean;
  lineGroupId: string;
  enabled: boolean;
}

// 收 webhook 時要一併取得該帳號的 server/apname/key（fetch record 用）
export interface NotifyConfigResolved extends NotifyConfigRow {
  server: string;
  apname: string;
  apiKey: string | null;
}

@Injectable()
export class NotifyConfigRepository {
  private encKey(): string {
    const k = process.env.LINE_CONFIG_ENC_KEY;
    if (!k) throw new Error("LINE_CONFIG_ENC_KEY env 未設");
    return k;
  }

  async create(tx: Db, c: {
    ragicAccountId: string; tenantId: string | null; sheetPath: string; sheetName: string;
    webhookToken: string; title: string | null; fields: NotifyConfigField[];
    notifyCreate: boolean; notifyUpdate: boolean; notifyDelete: boolean; lineGroupId: string; createdBy: string;
  }): Promise<{ configId: string }> {
    const res = await tx.execute<{ config_id: string }>(sql`
      INSERT INTO notify_config
        (ragic_account_id, tenant_id, sheet_path, sheet_name, webhook_token, title, fields,
         notify_create, notify_update, notify_delete, line_group_id, created_by)
      VALUES
        (${c.ragicAccountId}::uuid, ${c.tenantId}, ${c.sheetPath}, ${c.sheetName}, ${c.webhookToken},
         ${c.title}, ${JSON.stringify(c.fields)}::jsonb,
         ${c.notifyCreate}, ${c.notifyUpdate}, ${c.notifyDelete}, ${c.lineGroupId}, ${c.createdBy}::uuid)
      RETURNING config_id
    `);
    return { configId: res.rows[0].config_id };
  }

  async list(tx: Db): Promise<Array<NotifyConfigRow & { accountDisplayName: string }>> {
    const res = await tx.execute<{
      config_id: string; ragic_account_id: string; tenant_id: string | null; sheet_path: string; sheet_name: string;
      webhook_token: string; title: string | null; fields: NotifyConfigField[];
      notify_create: boolean; notify_update: boolean; notify_delete: boolean; line_group_id: string; enabled: boolean;
      account_display_name: string;
    }>(sql`
      SELECT c.config_id, c.ragic_account_id, c.tenant_id, c.sheet_path, c.sheet_name, c.webhook_token,
             c.title, c.fields, c.notify_create, c.notify_update, c.notify_delete, c.line_group_id, c.enabled,
             a.display_name AS account_display_name
      FROM notify_config c JOIN ragic_account a ON a.account_id = c.ragic_account_id
      ORDER BY c.created_at DESC
    `);
    return res.rows.map((r) => ({
      configId: r.config_id, ragicAccountId: r.ragic_account_id, tenantId: r.tenant_id,
      sheetPath: r.sheet_path, sheetName: r.sheet_name, webhookToken: r.webhook_token, title: r.title,
      fields: r.fields, notifyCreate: r.notify_create, notifyUpdate: r.notify_update, notifyDelete: r.notify_delete,
      lineGroupId: r.line_group_id, enabled: r.enabled, accountDisplayName: r.account_display_name,
    }));
  }

  // M2 webhook 用 · 依 token 取 config + 該帳號 server/apname/明碼 key
  async getResolvedByToken(tx: Db, token: string): Promise<NotifyConfigResolved | null> {
    const key = this.encKey();
    const res = await tx.execute<{
      config_id: string; ragic_account_id: string; tenant_id: string | null; sheet_path: string; sheet_name: string;
      webhook_token: string; title: string | null; fields: NotifyConfigField[];
      notify_create: boolean; notify_update: boolean; notify_delete: boolean; line_group_id: string; enabled: boolean;
      server: string; apname: string; api_key: string | null;
    }>(sql`
      SELECT c.config_id, c.ragic_account_id, c.tenant_id, c.sheet_path, c.sheet_name, c.webhook_token,
             c.title, c.fields, c.notify_create, c.notify_update, c.notify_delete, c.line_group_id, c.enabled,
             a.server, a.apname,
             CASE WHEN a.api_key_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(a.api_key_enc, ${key})::text END AS api_key
      FROM notify_config c JOIN ragic_account a ON a.account_id = c.ragic_account_id
      WHERE c.webhook_token = ${token} LIMIT 1
    `);
    const r = res.rows[0];
    if (!r) return null;
    return {
      configId: r.config_id, ragicAccountId: r.ragic_account_id, tenantId: r.tenant_id,
      sheetPath: r.sheet_path, sheetName: r.sheet_name, webhookToken: r.webhook_token, title: r.title,
      fields: r.fields, notifyCreate: r.notify_create, notifyUpdate: r.notify_update, notifyDelete: r.notify_delete,
      lineGroupId: r.line_group_id, enabled: r.enabled, server: r.server, apname: r.apname, apiKey: r.api_key,
    };
  }

  // 解析該租戶 LINE push token（reuse line_bot 表加密 token · 同 LINE_CONFIG_ENC_KEY）
  async getLineTokenForTenant(tx: Db, tenantId: string): Promise<string | null> {
    const key = this.encKey();
    const res = await tx.execute<{ token: string | null }>(sql`
      SELECT pgp_sym_decrypt(channel_access_token_enc, ${key})::text AS token
      FROM line_bot WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `);
    return res.rows[0]?.token ?? null;
  }

  async setEnabled(tx: Db, configId: string, enabled: boolean): Promise<void> {
    await tx.execute(sql`UPDATE notify_config SET enabled = ${enabled}, updated_at = now() WHERE config_id = ${configId}::uuid`);
  }

  async remove(tx: Db, configId: string): Promise<void> {
    await tx.execute(sql`DELETE FROM notify_config WHERE config_id = ${configId}::uuid`);
  }
}
