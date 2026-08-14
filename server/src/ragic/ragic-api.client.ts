import { BadGatewayException, BadRequestException, Injectable, Logger } from "@nestjs/common";

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
export interface RagicSchemaResult {
  sheetName: string;
  fields: RagicSchemaField[];
}

const FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class RagicApiClient {
  private readonly logger = new Logger(RagicApiClient.name);

  /**
   * 使用者從瀏覽器網址列複製表單路徑時，一定會帶上 `?PAGEID=xxx` 之類的 UI 參數
   * （2026-08-12 實際回報：填了 `/erp/1?PAGEID=WiL`）。那是 Ragic 網頁的參數、
   * 不屬於 API 路徑，帶著會讓 Ragic 回錯誤碼 102。
   *
   * 與其要求使用者自己看懂「不要帶問號後面的內容」，不如**直接幫他清掉** ——
   * 這裡沒有任何需要使用者判斷的東西，那一刀我方替他切。
   */
  static normalizeSheetPath(raw: string): string {
    const noQuery = raw.trim().split("?")[0].split("#")[0].replace(/\/+$/, "");
    return noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
  }

  private baseUrl(acc: RagicAccountRef, sheetPath: string): string {
    return `https://${acc.server}.ragic.com/${acc.apname}${RagicApiClient.normalizeSheetPath(sheetPath)}`;
  }

  private async fetchJson(url: string, apiKey: string): Promise<unknown> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { Authorization: `Basic ${apiKey}` }, signal: ctrl.signal });
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 160);
        throw new BadGatewayException(`Ragic 連線失敗（HTTP ${res.status}）· 回應：${body || "（空）"}`);
      }
      const body = await res.json();

      // ⚠️ Ragic 的錯誤是**用 HTTP 200 回的**（手冊 §15）：
      //    { "status":"ERROR", "code":106, "msg":"..." }
      //    所以不能只看 res.ok。不攔的話錯誤 body 會一路往下流，
      //    最後變成「回應無 fields（API key 權限不足？需帳號管理者）」這種**我們自己編的猜測**，
      //    而 Ragic 明明講了真正的原因（路徑錯 / 帳號名錯 / 金鑰過期…）。
      //    2026-07-29 prod 實際發生：使用者照著那句猜測換了帳號管理者金鑰，還是失敗。
      const e = body as { status?: string; code?: number; msg?: string };
      if (e?.status === "ERROR") throw new BadRequestException(ragicErrorMessage(e.code, e.msg));
      return body;
    } finally {
      clearTimeout(t);
    }
  }

  // 抓表單欄位定義（metadata/schema · 需帳號管理者 key）→ 供前端勾選
  async fetchSchemaFields(acc: RagicAccountRef, sheetPath: string): Promise<RagicSchemaResult> {
    const url = `${this.baseUrl(acc, sheetPath)}/metadata/schema?api`;
    const d = (await this.fetchJson(url, acc.apiKey)) as {
      sheet?: { sheetName?: string };
      fields?: Array<{ fieldId?: number; fieldName?: string; type?: string }>;
    };
    if (!Array.isArray(d.fields)) {
      // 走到這裡代表 Ragic 回 200、也不是 status=ERROR，但就是沒有 fields。
      // ⚠️ **不要再猜原因**（舊版寫「API key 權限不足？需帳號管理者」，
      //    使用者照做換了金鑰還是失敗）。把實際收到什麼講出來，讓人自己判斷。
      const keys = Object.keys(d ?? {}).slice(0, 8).join(", ") || "（空的）";
      throw new BadRequestException(`Ragic 沒有回傳欄位定義 · 實際收到的內容是：${keys}`);
    }
    const fields = d.fields
      .filter((f) => typeof f.fieldId === "number" && typeof f.fieldName === "string")
      .map((f) => ({ fieldId: f.fieldId as number, fieldName: f.fieldName as string, type: f.type ?? "" }));
    return { sheetName: d.sheet?.sheetName ?? "", fields };
  }

  // 抓單筆完整 record → { fieldId(字串): 值 }
  //
  // ⚠️ 必須帶 naming=EID。Ragic 預設回的 key 是「欄位名稱」，但規則存的 path 是
  // metadata/schema 給的「欄位 ID」——不指定就兩邊對不上，訊息每個欄位都變「（未填）」。
  // （更慘的是沒命名的欄位會回 "未命名" / "未命名2"，看起來像有資料其實根本取不到。）
  async fetchRecord(acc: RagicAccountRef, sheetPath: string, recordId: number | string): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl(acc, sheetPath)}/${recordId}?api&naming=EID`;
    const d = (await this.fetchJson(url, acc.apiKey)) as Record<string, unknown>;
    const rec = (d[String(recordId)] ?? Object.values(d)[0]) as Record<string, unknown> | undefined;
    if (!rec || typeof rec !== "object") throw new BadRequestException(`Ragic 找不到編號 ${recordId} 的資料`);
    return rec;
  }
}

/**
 * 把 Ragic 的錯誤碼翻成「看得懂 + 知道下一步」的中文。
 *
 * ⚠️ 重點不是翻譯，是**指出該去改哪一格**。
 * 對照手冊 §15。使用者看到的是這句話，所以它必須直接可行動 ——
 * 「無權限」三個字沒有用，「你填的帳號名不存在」才有用。
 */
function ragicErrorMessage(code: number | undefined, msg: string | undefined): string {
  const tail = msg ? ` · Ragic 原文：${msg}` : "";
  switch (code) {
    case 101: return `帳號名不存在 —— 檢查「帳號名」那格（網址裡 ragic.com/ 後面那一段）${tail}`;
    case 102: return `表單路徑無效 —— 檢查「表單路徑」，要含開頭的斜線、且不要帶問號後面的內容${tail}`;
    case 103: return `表單索引無效 —— 路徑最後那個數字不對（例 /service-tickets/10 的 10）${tail}`;
    case 105: return `這個請求需要登入驗證 —— 多半是金鑰沒被帶上或格式不對${tail}`;
    case 106: return `這把金鑰沒有權限 —— 讀取欄位定義需要**帳號管理者**的金鑰${tail}`;
    case 204: return `呼叫太頻繁被 Ragic 擋下 —— 等一下再試${tail}`;
    case 301: return `Ragic 連線階段逾時 —— 重試一次；持續發生請重新產生金鑰${tail}`;
    case 303: return `這個 Ragic 帳號已過期${tail}`;
    // Ragic 對「資料庫訂閱到期」回的是 403 而不是 303（2026-08-14 aitode 帳號實測）。
    // 掉到 default 的話只會顯示「錯誤代碼 403」，看的人不會知道要去續訂。
    case 403: return `這個 Ragic 帳號的訂閱已到期 —— 需以 SYSadmin 登入 Ragic 續訂，或改用免費方案；`
      + `在那之前這個帳號底下的通知都抓不到欄位內容${tail}`;
    case 304: return `金鑰無效 —— 可能已被重新產生而失效，請到 Ragic 個人設定重新產生並更新${tail}`;
    case 404: return `找不到資料${tail}`;
    default:  return `Ragic 回報錯誤（代碼 ${code ?? "未知"}）${tail}`;
  }
}
