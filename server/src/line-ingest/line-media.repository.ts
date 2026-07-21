import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

/**
 * line_media repository · 媒體下載結果落庫
 * 一 messageId 只對一 media · UNIQUE index 保證
 */
@Injectable()
export class LineMediaRepository {
  async insert(tx: Db, args: {
    tenantId: string;
    messageId: string;
    mediaType: string;
    storageBackend: string;
    storageKey: string | null;
    contentType: string | null;
    sizeBytes: number | null;
    originalFilename: string | null;
    sha256: string | null;
    downloadError: string | null;
  }): Promise<{ mediaId: string }> {
    const res = await tx.execute<{ media_id: string }>(sql`
      INSERT INTO line_media (
        tenant_id, message_id, media_type, storage_backend, storage_key,
        content_type, size_bytes, original_filename, sha256, download_error
      ) VALUES (
        ${args.tenantId}::uuid, ${args.messageId}, ${args.mediaType},
        ${args.storageBackend}, ${args.storageKey ?? null},
        ${args.contentType ?? null}, ${args.sizeBytes ?? null},
        ${args.originalFilename ?? null}, ${args.sha256 ?? null},
        ${args.downloadError ?? null}
      )
      ON CONFLICT (message_id) DO UPDATE SET
        storage_key = EXCLUDED.storage_key,
        content_type = EXCLUDED.content_type,
        size_bytes = EXCLUDED.size_bytes,
        sha256 = EXCLUDED.sha256,
        download_error = EXCLUDED.download_error,
        downloaded_at = now()
      RETURNING media_id
    `);
    const row = res.rows[0];
    if (!row) throw new Error("line_media insert 未回 media_id");
    return { mediaId: row.media_id };
  }
}
