import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

// line_bot repository · 走 raw sql 用 pgcrypto 加解密 channel_secret / access_token
// LINE_CONFIG_ENC_KEY env 提供加密 key（32+ chars）· 缺 crash on 使用（fail-loud）
// pattern 抄自 llm-config.repository.ts

export interface LineBotRow {
  botId: string;
  tenantId: string | null;         // utility bot 無租戶
  kind: "analysis" | "utility";
  name: string;
  botUserId: string;
  channelId: string | null;
  channelSecret: string;           // 解密後明碼（僅 backend 內部用 · 不 return API）
  channelAccessToken: string;      // 解密後明碼
  status: "active" | "disabled";
  webhookVerifiedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LineBotListRow {
  botId: string;
  tenantId: string | null;         // utility bot 無租戶
  kind: "analysis" | "utility";
  name: string;
  botUserId: string;
  channelId: string | null;
  status: "active" | "disabled";
  webhookVerifiedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  groupCount: number;
}

export interface LineBotInsertInput {
  tenantId: string | null;         // utility bot 傳 null
  kind: "analysis" | "utility";
  name: string;
  botUserId: string;
  channelId: string | null;
  channelSecret: string;
  channelAccessToken: string;
  createdBy: string;
}

@Injectable()
export class LineBotRepository {
  private readonly logger = new Logger(LineBotRepository.name);

  private encKey(): string {
    const k = process.env.LINE_CONFIG_ENC_KEY;
    if (!k || k.length < 32) {
      throw new Error("LINE_CONFIG_ENC_KEY 未設或長度 <32 · 請在 .env 加 32+ 字元 secret");
    }
    return k;
  }

  // 新增 bot · 加密 secret + access token · caller 保證 botUserId 唯一（透過 LINE test-call）
  async insert(tx: Db, input: LineBotInsertInput): Promise<string> {
    const key = this.encKey();
    const res = await tx.execute<{ bot_id: string }>(sql`
      INSERT INTO line_bot
        (tenant_id, kind, name, bot_user_id, channel_id, channel_secret_enc, channel_access_token_enc, created_by)
      VALUES
        (${input.tenantId}, ${input.kind}, ${input.name}, ${input.botUserId}, ${input.channelId},
         pgp_sym_encrypt(${input.channelSecret}, ${key}),
         pgp_sym_encrypt(${input.channelAccessToken}, ${key}),
         ${input.createdBy})
      RETURNING bot_id
    `);
    const row = res.rows[0];
    if (!row) throw new Error("insert line_bot 未回 bot_id");
    return row.bot_id;
  }

  async update(tx: Db, botId: string, patch: {
    name?: string;
    channelId?: string | null;
    channelSecret?: string;
    channelAccessToken?: string;
    status?: "active" | "disabled";
    tenantId?: string;
  }): Promise<void> {
    const key = this.encKey();
    await tx.execute(sql`
      UPDATE line_bot SET
        name = COALESCE(${patch.name ?? null}, name),
        channel_id = COALESCE(${patch.channelId ?? null}, channel_id),
        channel_secret_enc = CASE WHEN ${patch.channelSecret ?? null}::text IS NULL
          THEN channel_secret_enc ELSE pgp_sym_encrypt(${patch.channelSecret ?? null}, ${key}) END,
        channel_access_token_enc = CASE WHEN ${patch.channelAccessToken ?? null}::text IS NULL
          THEN channel_access_token_enc ELSE pgp_sym_encrypt(${patch.channelAccessToken ?? null}, ${key}) END,
        status = COALESCE(${patch.status ?? null}, status),
        tenant_id = COALESCE(${patch.tenantId ?? null}, tenant_id),
        updated_at = now()
      WHERE bot_id = ${botId}
    `);
  }

  // 遷移 tenant 時 · 該 bot 底下所有 groups 的 department_id 全 null · 因為舊 tenant 的 dept 對新 tenant 無意義
  async clearGroupDepartments(tx: Db, botId: string): Promise<number> {
    const res = await tx.execute<{ group_registry_id: string }>(sql`
      UPDATE line_group SET department_id = NULL
      WHERE bot_id = ${botId} AND department_id IS NOT NULL
      RETURNING group_registry_id
    `);
    return res.rows.length;
  }

  async markWebhookVerified(tx: Db, botId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE line_bot SET webhook_verified_at = COALESCE(webhook_verified_at, now())
      WHERE bot_id = ${botId}
    `);
  }

  // 讀單筆完整（含解密）· backend 內部用 · 不對外 return
  async getByIdWithSecrets(tx: Db, botId: string): Promise<LineBotRow | null> {
    const key = this.encKey();
    const res = await tx.execute<{
      bot_id: string; tenant_id: string | null; kind: "analysis" | "utility"; name: string; bot_user_id: string;
      channel_id: string | null; channel_secret: string; channel_access_token: string;
      status: "active" | "disabled"; webhook_verified_at: string | null;
      created_by: string | null; created_at: string; updated_at: string;
    }>(sql`
      SELECT bot_id, tenant_id, kind, name, bot_user_id, channel_id,
             pgp_sym_decrypt(channel_secret_enc, ${key})::text AS channel_secret,
             pgp_sym_decrypt(channel_access_token_enc, ${key})::text AS channel_access_token,
             status, webhook_verified_at::text, created_by,
             created_at::text, updated_at::text
      FROM line_bot
      WHERE bot_id = ${botId}
      LIMIT 1
    `);
    const r = res.rows[0];
    if (!r) return null;
    return {
      botId: r.bot_id,
      tenantId: r.tenant_id,
      kind: r.kind,
      name: r.name,
      botUserId: r.bot_user_id,
      channelId: r.channel_id,
      channelSecret: r.channel_secret,
      channelAccessToken: r.channel_access_token,
      status: r.status,
      webhookVerifiedAt: r.webhook_verified_at,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // Webhook lookup · 靠 bot_user_id (destination) 找 bot + secret 驗簽
  // 走 owner-context tx 或加 SECURITY DEFINER · webhook 無 session
  //
  // ⚠️ 這裡**不過濾 status** —— 由呼叫端判斷並分別記錄。
  //    原本查詢帶 `AND status = 'active'`，結果「bot 被停用」跟「查無此 bot」
  //    印同一句 log（webhook destination 不對應任何 bot），
  //    排查時會被導向「密鑰或設定壞了」的方向。
  //    （2026-07-28 鮮湧 bot 就是這樣被誤判的）
  async getByBotUserIdWithSecret(tx: Db, botUserId: string): Promise<{
    botId: string; tenantId: string; kind: string; channelSecret: string; channelAccessToken: string; status: string;
  } | null> {
    const key = this.encKey();
    const res = await tx.execute<{
      bot_id: string; tenant_id: string; kind: string;
      channel_secret: string; channel_access_token: string;
      status: string;
    }>(sql`
      SELECT bot_id, tenant_id, kind,
             pgp_sym_decrypt(channel_secret_enc, ${key})::text AS channel_secret,
             pgp_sym_decrypt(channel_access_token_enc, ${key})::text AS channel_access_token,
             status
      FROM line_bot
      WHERE bot_user_id = ${botUserId}
      LIMIT 1
    `);
    const r = res.rows[0];
    if (!r) return null;
    return {
      botId: r.bot_id,
      // utility bot 的 tenant_id 為 NULL；analysis bot 由 DB CHECK 保證非 NULL。
      // 型別留 string —— utility 分支在讀 tenantId 前就早退（line-webhook.service）。
      tenantId: r.tenant_id,
      kind: r.kind,
      channelSecret: r.channel_secret,
      channelAccessToken: r.channel_access_token,
      status: r.status,
    };
  }

  // 列表 · 走 tenant RLS · 不 return secret
  async listByTenant(tx: Db): Promise<LineBotListRow[]> {
    const res = await tx.execute<{
      bot_id: string; tenant_id: string | null; kind: "analysis" | "utility"; name: string; bot_user_id: string;
      channel_id: string | null; status: "active" | "disabled";
      webhook_verified_at: string | null; created_by: string | null;
      created_at: string; updated_at: string; group_count: string;
    }>(sql`
      SELECT b.bot_id, b.tenant_id, b.kind, b.name, b.bot_user_id, b.channel_id, b.status,
             b.webhook_verified_at::text, b.created_by,
             b.created_at::text, b.updated_at::text,
             (SELECT COUNT(*) FROM line_group WHERE bot_id = b.bot_id AND status = 'active')::text AS group_count
      FROM line_bot b
      ORDER BY b.created_at DESC
    `);
    return res.rows.map((r) => ({
      botId: r.bot_id,
      tenantId: r.tenant_id,
      kind: r.kind,
      name: r.name,
      botUserId: r.bot_user_id,
      channelId: r.channel_id,
      status: r.status,
      webhookVerifiedAt: r.webhook_verified_at,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      groupCount: Number(r.group_count),
    }));
  }

  // Get single (no secrets) · UI 用
  async getById(tx: Db, botId: string): Promise<LineBotListRow | null> {
    const res = await tx.execute<{
      bot_id: string; tenant_id: string | null; kind: "analysis" | "utility"; name: string; bot_user_id: string;
      channel_id: string | null; status: "active" | "disabled";
      webhook_verified_at: string | null; created_by: string | null;
      created_at: string; updated_at: string; group_count: string;
    }>(sql`
      SELECT b.bot_id, b.tenant_id, b.kind, b.name, b.bot_user_id, b.channel_id, b.status,
             b.webhook_verified_at::text, b.created_by,
             b.created_at::text, b.updated_at::text,
             (SELECT COUNT(*) FROM line_group WHERE bot_id = b.bot_id AND status = 'active')::text AS group_count
      FROM line_bot b
      WHERE b.bot_id = ${botId}
      LIMIT 1
    `);
    const r = res.rows[0];
    if (!r) return null;
    return {
      botId: r.bot_id,
      tenantId: r.tenant_id,
      kind: r.kind,
      name: r.name,
      botUserId: r.bot_user_id,
      channelId: r.channel_id,
      status: r.status,
      webhookVerifiedAt: r.webhook_verified_at,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      groupCount: Number(r.group_count),
    };
  }

  // Mask token / secret · UI 顯示遮罩
  static mask(s: string): string {
    if (s.length <= 10) return "***";
    return `${s.slice(0, 4)}***${s.slice(-4)}`;
  }
}
