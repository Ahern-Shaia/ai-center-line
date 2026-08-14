import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { NotificationTemplate } from "../db/schema.js";
import type { RuleRow } from "./types.js";

const SELECT_COLS = sql`
  rule_id, tenant_id, name, enabled, source_type, source_config, webhook_token,
  template, channel_type, channel_target, bot_id
`;

// 用 type alias（非 interface）· drizzle execute<T> 需要隱式 index signature
type RawRule = {
  rule_id: string; tenant_id: string | null; name: string; enabled: boolean;
  source_type: RuleRow["sourceType"]; source_config: Record<string, unknown>;
  webhook_token: string | null; template: NotificationTemplate;
  channel_type: RuleRow["channelType"]; channel_target: string | null;
  bot_id: string | null;
};

function toRow(r: RawRule): RuleRow {
  return {
    ruleId: r.rule_id, tenantId: r.tenant_id, name: r.name, enabled: r.enabled,
    sourceType: r.source_type, sourceConfig: r.source_config ?? {},
    webhookToken: r.webhook_token, template: r.template,
    channelType: r.channel_type, channelTarget: r.channel_target,
    botId: r.bot_id ?? null,
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
    botId?: string | null;
  }): Promise<{ ruleId: string }> {
    const res = await tx.execute<{ rule_id: string }>(sql`
      INSERT INTO notification_rule
        (tenant_id, name, source_type, source_config, webhook_token, template, channel_type, channel_target, bot_id, created_by)
      VALUES
        (${input.tenantId}, ${input.name}, ${input.sourceType}, ${JSON.stringify(input.sourceConfig)}::jsonb,
         ${input.webhookToken}, ${JSON.stringify(input.template)}::jsonb,
         ${input.channelType}, ${input.channelTarget}, ${input.botId ?? null}, ${input.createdBy}::uuid)
      RETURNING rule_id
    `);
    return { ruleId: res.rows[0].rule_id };
  }

  /**
   * 編輯規則 · 只動「可以改的部分」。
   *
   * ⚠️ 刻意不讓改 sheetPath 與 webhookToken：
   * webhook 網址已經貼在客戶的 Ragic 那一側，改了這兩個就等於換一條規則，
   * 而客戶那邊不會知道，通知會悄悄停掉。要換表單請新增一條。
   */
  async update(tx: Db, ruleId: string, a: {
    name: string;
    events: { create: boolean; update: boolean; delete: boolean } | null;
    template: unknown;
    channelType: string;
    channelTarget: string;
    /** undefined = 不動；string = 設定 */
    botId?: string | null;
    /** undefined = 不動 · 換 Ragic 帳號＝同一張表單改讀另一個 Ragic 資料庫（webhook 網址不變）*/
    ragicAccountId?: string;
  }): Promise<boolean> {
    // source_config 只能在 SET 裡出現一次（同一欄位不可重複賦值），所以兩個 patch 疊起來組成一個運算式
    const withAccount = a.ragicAccountId === undefined
      ? sql`source_config`
      : sql`jsonb_set(source_config, '{ragicAccountId}', to_jsonb(${a.ragicAccountId}::text))`;
    const nextConfig = a.events === null
      ? withAccount
      : sql`jsonb_set(${withAccount}, '{events}', ${JSON.stringify(a.events)}::jsonb)`;

    const res = await tx.execute<{ rule_id: string }>(sql`
      UPDATE notification_rule
         SET name = ${a.name},
             source_config = ${nextConfig},
             template = ${JSON.stringify(a.template)}::jsonb,
             channel_type = ${a.channelType},
             channel_target = ${a.channelTarget},
             bot_id = CASE WHEN ${a.botId !== undefined}::boolean
                      THEN ${a.botId ?? null}::uuid ELSE bot_id END,
             updated_at = now()
       WHERE rule_id = ${ruleId}::uuid
      RETURNING rule_id::text
    `);
    return res.rows.length > 0;
  }

  async getById(tx: Db, ruleId: string): Promise<RuleRow | null> {
    const res = await tx.execute<RawRule>(sql`
      SELECT ${SELECT_COLS} FROM notification_rule WHERE rule_id = ${ruleId}::uuid LIMIT 1
    `);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async setEnabled(tx: Db, ruleId: string, enabled: boolean): Promise<void> {
    await tx.execute(sql`UPDATE notification_rule SET enabled = ${enabled}, updated_at = now() WHERE rule_id = ${ruleId}::uuid`);
  }

  async remove(tx: Db, ruleId: string): Promise<void> {
    await tx.execute(sql`DELETE FROM notification_rule WHERE rule_id = ${ruleId}::uuid`);
  }

  /** 該租戶的 LINE push token（line_bot 加密欄位 · 同 LINE_CONFIG_ENC_KEY）*/
  /**
   * 依規則指定的 bot 取 token —— **這是正確的取法**。
   *
   * LINE 的群組 ID 依 bot 發放，所以「用哪支 bot 發」必須跟「目標群屬於哪支 bot」一致。
   * 用租戶去猜（見下面的 getLineTokenForTenant）在單一 bot 時碰巧會對，多一支就靜默送錯家。
   */
  async getLineTokenForBot(tx: Db, botId: string): Promise<string | null> {
    const key = this.encKey();
    const res = await tx.execute<{ token: string | null }>(sql`
      SELECT pgp_sym_decrypt(channel_access_token_enc, ${key})::text AS token
      FROM line_bot WHERE bot_id = ${botId}::uuid AND status = 'active'
      LIMIT 1
    `);
    return res.rows[0]?.token ?? null;
  }

  /**
   * ⚠️ **過渡用 · 這是猜的。** 取「該租戶最新建立的 active bot」——
   * 租戶只有一支時碰巧正確，多一支就會靜默送到錯的地方。
   * 只在規則還沒有 bot_id（0061 之前建立的）時才走這裡；資料補完後應刪除。
   * 見 docs/modules/notify-bot-scoped-target.md §2.2
   */
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
