import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import { withSystemTx } from "../db/client.js";
import { MediaStorageService } from "../line-ingest/media-storage.service.js";
import { RETENTION_DAYS } from "./media.service.js";

/**
 * 保留期到了就把檔案真的抹掉 · docs/modules/media-and-vision.md §7
 *
 * 刪除是兩段式的：使用者按刪除只是隱藏（30 天內救得回來），
 * 這支排程負責第二段 —— 期限一到，把 R2 物件真的清掉。
 * 沒有這支的話「30 天後自動清掉」就只是一句寫在畫面上的空話，
 * 而誤傳的個資照片會永遠留在儲存空間裡。
 *
 * 一列一列處理、不用批次交易：抹掉一個就記一個。
 * 中途掛掉頂多下次再跑，不會發生「DB 說清了但檔案還在」。
 */
@Injectable()
export class MediaPurgeService {
  private readonly logger = new Logger(MediaPurgeService.name);

  constructor(private readonly storage: MediaStorageService) {}

  @Cron("30 3 * * *", { timeZone: "Asia/Taipei" })
  async purgeExpired(): Promise<{ purged: number; failed: number }> {
    if (!this.storage.enabled) {
      this.logger.warn("儲存空間未設定 · 跳過到期清除（檔案會一直留著）");
      return { purged: 0, failed: 0 };
    }

    const expired = await withSystemTx((tx) =>
      tx.execute<{ media_id: string; storage_key: string | null }>(sql`
        SELECT media_id::text, storage_key
          FROM line_media
         WHERE deleted_at IS NOT NULL
           AND purged_at IS NULL
           AND deleted_at < now() - (${RETENTION_DAYS} || ' days')::interval
         ORDER BY deleted_at
         LIMIT 500
      `),
    );
    if (expired.rows.length === 0) return { purged: 0, failed: 0 };

    let purged = 0;
    let failed = 0;
    for (const row of expired.rows) {
      try {
        // 先抹 R2 再寫 DB。反過來的話一旦中間失敗，DB 說清掉了、檔案其實還在，
        // 而且不會再被撈出來重試 —— 「以為刪了其實沒刪」是最糟的結局。
        if (row.storage_key) await this.storage.remove(row.storage_key);
        await withSystemTx((tx) => tx.execute(sql`
          UPDATE line_media SET purged_at = now(), storage_key = NULL
           WHERE media_id = ${row.media_id}::uuid
        `));
        purged += 1;
      } catch (e) {
        failed += 1;
        this.logger.error(`清除失敗 · media=${row.media_id}`, e as Error);
      }
    }
    this.logger.log(`到期清除完成 · 已清 ${purged} 個 · 失敗 ${failed} 個`);
    return { purged, failed };
  }
}
