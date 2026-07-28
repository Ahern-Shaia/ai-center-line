import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx, withSystemTx, withTenant, type Db } from "../db/client.js";
import { RagicConnector } from "../data-sync-layer/connectors/ragic.js";
import { RagicAccountRepository } from "../ragic/ragic-account.repository.js";
import { MasterDataRepository } from "./master-data.repository.js";

const PAGE = 200;
const MAX_ROWS = 5000;      // 單次上限（F-5）· 超過只警告不中斷既有資料

/**
 * 主檔同步 · docs/modules/master-data-sync.md
 *
 * 核心不是「新寫拉取」——`RagicConnector.pullCustomers()` 早就寫好了。
 * 它從沒跑過的唯一原因是憑證走環境變數（每接一個租戶要改 env 重新部署），
 * 所以沒人設過。這裡把憑證改成從 `ragic_account` 讀（客戶已在通知設定連好、48 則通知在跑）。
 */
@Injectable()
export class MasterDataSyncService {
  private readonly logger = new Logger(MasterDataSyncService.name);

  constructor(
    private readonly repo: MasterDataRepository,
    private readonly accounts: RagicAccountRepository,
  ) {}

  /** 立即同步（畫面上按的）· 走呼叫者的 tenant context */
  async syncNow(tenantId: string): Promise<{ count: number }> {
    return this.runSync(tenantId, currentTx());
  }

  /**
   * 排程用 · 自己開 tenant context。
   * ⚠️ 用 aiproot_admin 不用 system：ragic_account 的 RLS 只認
   * aiproot_admin / consultant / system，但 master_data_source 與 data_sync_customer
   * 需要 current_tenant 才查得到 —— 兩者都要滿足，所以帶 tenant + aiproot_admin。
   */
  async syncTenant(tenantId: string): Promise<{ count: number }> {
    return withTenant({ tenantId, role: "aiproot_admin" }, (tx) => this.runSync(tenantId, tx));
  }

  private async runSync(tenantId: string, tx: Db): Promise<{ count: number }> {
    const src = await this.repo.getSource(tx, tenantId);
    if (!src) throw new BadRequestException("尚未設定客戶名冊來源");
    if (!src.enabled) throw new BadRequestException("這個來源目前是停用的");
    if (src.provider !== "ragic") {
      throw new BadRequestException("CSV 來源請用上傳，不需要同步");
    }
    if (!src.accountId || !src.sheetPath || !src.nameField) {
      throw new BadRequestException("來源設定不完整 · 需要 Ragic 帳號、表單路徑與名稱欄位");
    }

    try {
      const acc = await this.accounts.getWithKey(tx, src.accountId);
      if (!acc?.apiKey) throw new Error("Ragic 帳號尚未設定 API key");

      const connector = new RagicConnector({
        tenantId,
        baseUrl: `https://${acc.server}.ragic.com`,
        account: acc.apname,
        apiKey: acc.apiKey,
        sheetPaths: { customer: src.sheetPath },
        // 只拉名稱與編號 —— 隱私設計（§3 · F-1）：沒拉進來的不會外洩
        fieldMap: { customer: { name: src.nameField, code: src.codeField ?? undefined } },
      });

      const fields = [src.nameField, src.codeField].filter((f): f is string => !!f);
      const collected: Array<{ sourceRecordId: string; name: string; code: string | null; sheetPath: string | null }> = [];

      for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
        const page = await connector.pullCustomers({ limit: PAGE, offset, fields });
        for (const c of page) {
          collected.push({
            sourceRecordId: c.sourceRecordId,
            name: c.name,
            code: c.code ?? null,
            sheetPath: src.sheetPath,
          });
        }
        if (page.length < PAGE) break;
      }
      if (collected.length >= MAX_ROWS) {
        this.logger.warn(`主檔同步達單次上限 ${MAX_ROWS} · tenant=${tenantId} · 只同步了前 ${MAX_ROWS} 筆`);
      }

      const count = await this.repo.replaceCustomers(tx, tenantId, "ragic", collected);
      await this.repo.recordSyncResult(tx, src.sourceId, count, null);
      this.logger.log(`主檔同步完成 · tenant=${tenantId} · ${count} 筆`);
      return { count };
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      // 失敗要留下來 —— 不然主檔停止更新沒有任何人會發現（F-4 靜默失效）
      await this.repo.recordSyncResult(tx, src.sourceId, null, msg.slice(0, 500));
      throw e;
    }
  }

  /** 排程用 · 撈出所有設好且啟用的 Ragic 來源 */
  async listSyncableTenants(): Promise<string[]> {
    const r = await withSystemTx((tx) => tx.execute<{ tenant_id: string }>(sql`
      SELECT tenant_id::text FROM master_data_source
       WHERE kind = 'customer' AND provider = 'ragic' AND enabled
         AND account_id IS NOT NULL AND sheet_path IS NOT NULL AND name_field IS NOT NULL
    `));
    return r.rows.map((x) => x.tenant_id);
  }
}
