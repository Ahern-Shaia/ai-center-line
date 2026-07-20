import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { LLMProviderName } from "./provider.interface.js";

// LLM config repository · 走 raw sql 用 pgcrypto 加解密 apiKey
// LLM_CONFIG_ENC_KEY env 提供加密 key（32+ chars）· 缺 crash on 使用（fail-loud）

export interface LlmConfigRow {
  tenantId: string;
  provider: LLMProviderName;
  model: string;
  apiKey: string;                            // 解密後明碼（僅 backend 內部用 · 不 return API）
  baseUrl: string | null;
  temperature: number | null;
  maxTokens: number | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface LlmConfigSaveInput {
  tenantId: string;
  provider: LLMProviderName;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  updatedBy: string;
}

@Injectable()
export class LlmConfigRepository {
  private readonly logger = new Logger(LlmConfigRepository.name);

  private encKey(): string {
    const k = process.env.LLM_CONFIG_ENC_KEY;
    if (!k || k.length < 32) {
      throw new Error("LLM_CONFIG_ENC_KEY 未設或長度 <32 · 請在 .env 加 32+ 字元 secret");
    }
    return k;
  }

  async upsert(tx: Db, input: LlmConfigSaveInput): Promise<void> {
    const key = this.encKey();
    await tx.execute(sql`
      INSERT INTO tenant_llm_config
        (tenant_id, provider, model, api_key_enc, base_url, temperature, max_tokens, updated_at, updated_by)
      VALUES
        (${input.tenantId}, ${input.provider}, ${input.model},
         pgp_sym_encrypt(${input.apiKey}, ${key}),
         ${input.baseUrl ?? null},
         ${input.temperature ?? null},
         ${input.maxTokens ?? null},
         now(),
         ${input.updatedBy})
      ON CONFLICT (tenant_id) DO UPDATE SET
        provider = EXCLUDED.provider,
        model = EXCLUDED.model,
        api_key_enc = EXCLUDED.api_key_enc,
        base_url = EXCLUDED.base_url,
        temperature = EXCLUDED.temperature,
        max_tokens = EXCLUDED.max_tokens,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by
    `);
  }

  async get(tx: Db, tenantId: string): Promise<LlmConfigRow | null> {
    const key = this.encKey();
    const res = await tx.execute<{
      tenant_id: string;
      provider: LLMProviderName;
      model: string;
      api_key: string;
      base_url: string | null;
      temperature: string | null;
      max_tokens: number | null;
      updated_at: string;
      updated_by: string | null;
    }>(sql`
      SELECT tenant_id, provider, model,
             pgp_sym_decrypt(api_key_enc, ${key})::text AS api_key,
             base_url, temperature, max_tokens, updated_at::text, updated_by
      FROM tenant_llm_config
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `);
    const row = res.rows[0];
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      provider: row.provider,
      model: row.model,
      apiKey: row.api_key,
      baseUrl: row.base_url,
      temperature: row.temperature != null ? Number(row.temperature) : null,
      maxTokens: row.max_tokens,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  // 用於 API 回應 · mask apiKey（sk-***XXXX）避免明碼 return
  maskApiKey(apiKey: string): string {
    if (apiKey.length <= 10) return "***";
    return `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}`;
  }
}
