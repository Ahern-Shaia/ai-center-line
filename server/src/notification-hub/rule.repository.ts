import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { NotificationTemplate } from "../db/schema.js";
import type { RuleRow } from "./types.js";

const SELECT_COLS = sql`
  rule_id, tenant_id, name, enabled, source_type, source_config, webhook_token,
  template, channel_type, channel_target
`;

// 用 type alias（非 interface）· drizzle execute<T> 需要隱式 index signature
type RawRule = {
  rule_id: string; tenant_id: string | null; name: string; enabled: boolean;
  source_type: RuleRow["sourceType"]; source_config: Record<string, unknown>;
  webhook_token: string | null; template: NotificationTemplate;
  channel_type: RuleRow["channelType"]; channel_target: string | null;
};

function toRow(r: RawRule): RuleRow {
  return {
    ruleId: r.rule_id, tenantId: r.tenant_id, name: r.name, enabled: r.enabled,
    sourceType: r.source_type, sourceConfig: r.source_config ?? {},
    webhookToken: r.webhook_token, template: r.template,
    channelType: r.channel_type, channelTarget: r.channel_target,
  };
}

@Injectable()
export class RuleRepository {
  private encKey(): string {
    const k = process.env.LINE_CONFIG_ENC_KEY;
    if (!k) throw new Error("LINE_CONFIG_ENC_KEY env 未設");
    return k;
  }

  async getByWebhookToken(tx: Db, token: string): Promise<RuleRow | null> {
    const res = await tx.execute<RawRule>(sql`
      SELECT ${SELECT_COLS} FROM notification_rule WHERE webhook_token = ${token} LIMIT 1
    `);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  /** internal_event 分派：找該 eventType 的啟用規則（tenant 相符或規則未綁 tenant）*/
  async listEnabledForEvent(tx: Db, eventType: string, tenantId: string | null): Promise<RuleRow[]> {
    const res = await tx.execute<RawRule>(sql`
      SELECT ${SELECT_COLS} FROM notification_rule
      WHERE enabled = true
        AND source_type = 'internal_event'
        AND source_config->>'eventType' = ${eventType}
        AND (tenant_id IS NULL OR tenant_id = ${tenantId}::uuid)
    `);
    return res.rows.map(toRow);
  }

  async list(tx: Db): Promise<Array<RuleRow & { accountDisplayName: string | null }>> {
    const res = await tx.execute<RawRule & { account_display_name: string | null }>(sql`
      SELECT r.rule_id, r.tenant_id, r.name, r.enabled, r.source_type, r.source_config, r.webhook_token,
             r.template, r.channel_type, r.channel_target,
             a.display_name AS account_display_name
      FROM notification_rule r
      LEFT JOIN ragic_account a
        ON r.source_type = 'ragic_form'
       AND a.account_id = (r.source_config->>'ragicAccountId')::uuid
      ORDER BY r.created_at DESC
    `);
    return res.rows.map((r) => ({ ...toRow(r), accountDisplayName: r.account_display_name }));
  }

  async create(tx: Db, input: {
    tenantId: string | null; name: string; sourceType: RuleRow["sourceType"];
    sourceConfig: Record<string, unknown>; webhookToken: string | null;
    template: NotificationTemplate; channelType: RuleRow["channelType"];
    channelTarget: string | null; createdBy: string;
  }): Promise<{ ruleId: string }> {
    const res = await tx.execute<{ rule_id: string }>(sql`
      INSERT INTO notification_rule
        (tenant_id, name, source_type, source_config, webhook_token, template, channel_type, channel_target, created_by)
      VALUES
        (${input.tenantId}, ${input.name}, ${input.sourceType}, ${JSON.stringify(input.sourceConfig)}::jsonb,
         ${input.webhookToken}, ${JSON.stringify(input.template)}::jsonb,
         ${input.channelType}, ${input.channelTarget}, ${input.createdBy}::uuid)
      RETURNING rule_id
    `);
    return { ruleId: res.rows[0].rule_id };
  }

  async setEnabled(tx: Db, ruleId: string, enabled: boolean): Promise<void> {
    await tx.execute(sql`UPDATE notification_rule SET enabled = ${enabled}, updated_at = now() WHERE rule_id = ${ruleId}::uuid`);
  }

  async remove(tx: Db, ruleId: string): Promise<void> {
    await tx.execute(sql`DELETE FROM notification_rule WHERE rule_id = ${ruleId}::uuid`);
  }

  /** 該租戶的 LINE push token（line_bot 加密欄位 · 同 LINE_CONFIG_ENC_KEY）*/
  async getLineTokenForTenant(tx: Db, tenantId: string): Promise<string | null> {
    const key = this.encKey();
    const res = await tx.execute<{ token: string | null }>(sql`
      SELECT pgp_sym_decrypt(channel_access_token_enc, ${key})::text AS token
      FROM line_bot WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `);
    return res.rows[0]?.token ?? null;
  }

  /** line_user 管道 · 由本系統 user_id 解析出 LINE userId（存 user_id 而非 LINE id → 重新綁定仍有效）*/
  async resolveLineUserId(tx: Db, userId: string): Promise<string | null> {
    const res = await tx.execute<{ line_user_id: string }>(sql`
      SELECT line_user_id FROM user_line_binding
      WHERE user_id = ${userId}::uuid AND status = 'active'
      ORDER BY bound_at DESC LIMIT 1
    `);
    return res.rows[0]?.line_user_id ?? null;
  }

  /** 設定 UI 用 · 該租戶可選的通知對象（已綁 LINE 的成員）*/
  async listNotifiableUsers(tx: Db, tenantId: string): Promise<Array<{ userId: string; name: string }>> {
    const res = await tx.execute<{ user_id: string; name: string }>(sql`
      SELECT u.user_id, COALESCE(NULLIF(u.display_name, ''), u.email) AS name
      FROM users u
      JOIN user_line_binding b ON b.user_id = u.user_id AND b.status = 'active'
      WHERE u.tenant_id = ${tenantId}::uuid
      ORDER BY name
    `);
    return res.rows.map((r) => ({ userId: r.user_id, name: r.name }));
  }

  /** ragic_form 來源用 · 取該帳號 server/apname/明碼 key */
  async getRagicAccount(tx: Db, accountId: string): Promise<{ server: string; apname: string; apiKey: string | null } | null> {
    const key = this.encKey();
    const res = await tx.execute<{ server: string; apname: string; api_key: string | null }>(sql`
      SELECT server, apname,
             CASE WHEN api_key_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(api_key_enc, ${key})::text END AS api_key
      FROM ragic_account WHERE account_id = ${accountId}::uuid LIMIT 1
    `);
    const r = res.rows[0];
    return r ? { server: r.server, apname: r.apname, apiKey: r.api_key } : null;
  }
}
