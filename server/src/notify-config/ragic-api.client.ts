import { Injectable, Logger } from "@nestjs/common";

// Ragic HTTP API 呼叫（Basic auth：Authorization: Basic <API_KEY>，key 當帳號免密碼）
// 對照 docs/ragic-http-api-手冊.md §1 §3 §13
export interface RagicAccountRef {
  server: string;   // www / ap16 / na3 / eu2
  apname: string;   // 帳號名（如 aitode）
  apiKey: string;
}
export interface RagicSchemaField {
  fieldId: number;
  fieldName: string;
  type: string;
}

const FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class RagicApiClient {
  private readonly logger = new Logger(RagicApiClient.name);

  private baseUrl(acc: RagicAccountRef, sheetPath: string): string {
    const p = sheetPath.startsWith("/") ? sheetPath : `/${sheetPath}`;
    return `https://${acc.server}.ragic.com/${acc.apname}${p}`;
  }

  private async fetchJson(url: string, apiKey: string): Promise<unknown> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { Authorization: `Basic ${apiKey}` }, signal: ctrl.signal });
      if (!res.ok) {
        throw new Error(`Ragic ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
      }
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  // 抓表單欄位定義（metadata/schema · 需帳號管理者 key）→ 供前端勾選
  async fetchSchemaFields(acc: RagicAccountRef, sheetPath: string): Promise<RagicSchemaField[]> {
    const url = `${this.baseUrl(acc, sheetPath)}/metadata/schema?api`;
    const d = (await this.fetchJson(url, acc.apiKey)) as {
      fields?: Array<{ fieldId?: number; fieldName?: string; type?: string }>;
    };
    if (!Array.isArray(d.fields)) {
      throw new Error("Ragic schema 回應無 fields（API key 權限不足？需帳號管理者）");
    }
    return d.fields
      .filter((f) => typeof f.fieldId === "number" && typeof f.fieldName === "string")
      .map((f) => ({ fieldId: f.fieldId as number, fieldName: f.fieldName as string, type: f.type ?? "" }));
  }

  // 抓單筆完整 record → { fieldId(字串): 值 }
  async fetchRecord(acc: RagicAccountRef, sheetPath: string, recordId: number | string): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl(acc, sheetPath)}/${recordId}?api`;
    const d = (await this.fetchJson(url, acc.apiKey)) as Record<string, unknown>;
    const rec = (d[String(recordId)] ?? Object.values(d)[0]) as Record<string, unknown> | undefined;
    if (!rec || typeof rec !== "object") throw new Error(`Ragic record ${recordId} 找不到`);
    return rec;
  }
}
