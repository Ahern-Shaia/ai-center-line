import { Injectable } from "@nestjs/common";
import { currentTx, db as rawDb } from "../db/client.js";
import { LlmConfigRepository, type LlmConfigRow } from "./llm-config.repository.js";
import type { LlmConfigUpsertPayload } from "./dto/llm-config.dto.js";

@Injectable()
export class LlmConfigService {
  constructor(private readonly repo: LlmConfigRepository) {}

  async saveConfig(
    tenantId: string,
    payload: LlmConfigUpsertPayload,
    updatedBy: string,
  ): Promise<{ masked: string }> {
    const tx = currentTx();
    await this.repo.upsert(tx, {
      tenantId,
      provider: payload.provider,
      model: payload.model,
      apiKey: payload.apiKey,
      baseUrl: payload.baseUrl,
      temperature: payload.temperature,
      maxTokens: payload.maxTokens,
      updatedBy,
    });
    return { masked: this.repo.maskApiKey(payload.apiKey) };
  }

  async getMasked(tenantId: string): Promise<Omit<LlmConfigRow, "apiKey"> & { apiKeyMasked: string | null } | null> {
    const tx = currentTx();
    const row = await this.repo.get(tx, tenantId);
    if (!row) return null;
    const { apiKey, ...rest } = row;
    return { ...rest, apiKeyMasked: this.repo.maskApiKey(apiKey) };
  }

  async deleteConfig(tenantId: string): Promise<{ deleted: boolean }> {
    const tx = currentTx();
    return this.repo.delete(tx, tenantId);
  }

  // 給 pipeline 用 · 讀明碼 apiKey · 走 raw db（sync job 在 request scope 外）
  async getForRuntime(tenantId: string): Promise<LlmConfigRow | null> {
    return this.repo.get(rawDb, tenantId);
  }
}
