import { Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";
import { MediaStorageService } from "../line-ingest/media-storage.service.js";

// 素材看板 · docs/modules/media-and-vision.md §2
//
// 這頁在 2026-07-27 之前讀的是 mockdata/mediaFiles.ts 的 17 筆虛構檔案，
// 但 R2 其實一直正常運作（prod 已存 135 個檔案 / 83 MB / 0 失敗）——
// 也就是說「檔案不見了」是純粹的顯示問題，不是儲存問題。
//
// 兩件事情這裡刻意不做：
//   · 不產縮圖（要引入影像處理依賴，需另行授權）→ 改以分頁 + 前端 lazy load 控流量（FMEA F-7）
//   · 不回 R2 網址（永久有效的網址等於公開檔案）→ 檔案一律由 /media/:id/content 代理（F-2）

export type MediaKind = "image" | "video" | "audio" | "file";

export interface MediaItem {
  mediaId: string;
  kind: MediaKind;
  contentType: string | null;
  sizeBytes: number | null;
  filename: string | null;
  /** 同群鄰近的文字訊息 · 讓卡片看得出「這張是什麼」 */
  caption: string | null;
  groupName: string | null;
  departmentName: string | null;
  senderName: string | null;
  sentAt: string;
  /** 已刪除清單才有 · 還剩幾天可還原（0 = 今天到期） */
  daysLeft?: number;
  deletedByName?: string | null;
}

export interface MediaListResult {
  items: MediaItem[];
  total: number;
  counts: Record<MediaKind | "all", number>;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 24;

/** 軟刪除後保留幾天可還原 · 到期由排程抹掉 R2 物件（用戶 2026-07-28 裁定） */
export const RETENTION_DAYS = 30;

// group_owner 只看得到自己部門的媒體。line_message.department_id 是「當下分派部門」的
// snapshot，與 tickets 的 RLS 同源 —— 用同一個判斷式，避免兩套範圍規則長歪（FMEA F-3）。
const DEPT_SCOPE = sql`(
  current_setting('app.actor_role', true) IS DISTINCT FROM 'group_owner'
  OR m.department_id = nullif(current_setting('app.current_department', true), '')::uuid
)`;

@Injectable()
export class MediaService {
  constructor(private readonly storage: MediaStorageService) {}

  async list(opts: { kind?: string; page?: number; deleted?: boolean } = {}): Promise<MediaListResult> {
    const tx = currentTx();
    const kind = isKind(opts.kind) ? opts.kind : null;
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const offset = (page - 1) * PAGE_SIZE;
    // 已刪除清單只列「還救得回來」的：purged 之後檔案已經不在，列出來也還原不了
    const state = opts.deleted
      ? sql`md.deleted_at IS NOT NULL AND md.purged_at IS NULL`
      : sql`md.deleted_at IS NULL`;

    // 只列真的存下來的檔案。下載失敗的（storage_key is null）列出來只會讓人點了拿到 404。
    const counts = await tx.execute<{ media_type: MediaKind; n: number }>(sql`
      SELECT md.media_type, count(*)::int AS n
        FROM line_media md
        JOIN line_message m ON m.message_id = md.message_id
       WHERE md.storage_key IS NOT NULL AND ${DEPT_SCOPE} AND ${state}
       GROUP BY 1
    `);
    const countMap = { all: 0, image: 0, video: 0, audio: 0, file: 0 } as Record<MediaKind | "all", number>;
    for (const r of counts.rows) {
      countMap[r.media_type] = r.n;
      countMap.all += r.n;
    }

    const res = await tx.execute<{
      media_id: string; media_type: MediaKind; content_type: string | null;
      size_bytes: string | number | null; original_filename: string | null;
      caption: string | null; group_name: string | null; department_name: string | null;
      sender_name: string | null; sent_at: string;
      days_left: number | null; deleted_by_name: string | null;
    }>(sql`
      SELECT md.media_id::text          AS media_id,
             md.media_type,
             md.content_type,
             md.size_bytes,
             md.original_filename,
             g.display_name             AS group_name,
             d.department_name,
             lm.display_name            AS sender_name,
             -- 明確給標準 ISO：pg 預設字串是「2026-07-27 14:44:46+00」（沒有 T），
             -- 部分瀏覽器丟進 new Date() 會變 Invalid Date
             to_char(m.sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS sent_at,
             -- 同群前後三分鐘內最近的一則文字 · 多數人是「先打字再傳圖」或反之
             (SELECT t.text_content
                FROM line_message t
               WHERE t.group_id = m.group_id
                 AND t.message_type = 'text'
                 AND nullif(btrim(t.text_content), '') IS NOT NULL
                 AND t.sent_at BETWEEN m.sent_at - interval '3 minutes'
                                   AND m.sent_at + interval '3 minutes'
               ORDER BY abs(extract(epoch FROM (t.sent_at - m.sent_at)))
               LIMIT 1)                 AS caption,
             GREATEST(0, ${RETENTION_DAYS} - floor(
               extract(epoch FROM (now() - md.deleted_at)) / 86400)::int) AS days_left,
             du.display_name            AS deleted_by_name
        FROM line_media md
        JOIN line_message m  ON m.message_id = md.message_id
        LEFT JOIN line_group g ON g.group_id = m.group_id
        LEFT JOIN departments d ON d.department_id = m.department_id
        LEFT JOIN line_member lm ON lm.group_id = m.group_id AND lm.user_id = m.sender_line_id
        LEFT JOIN users du ON du.user_id = md.deleted_by
       WHERE md.storage_key IS NOT NULL
         AND ${DEPT_SCOPE}
         AND ${state}
         AND (${kind}::text IS NULL OR md.media_type = ${kind}::text)
       ORDER BY ${opts.deleted ? sql`md.deleted_at DESC` : sql`m.sent_at DESC`}
       LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `);

    return {
      items: res.rows.map((r) => ({
        mediaId: r.media_id,
        kind: r.media_type,
        contentType: r.content_type,
        sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
        filename: r.original_filename,
        caption: r.caption?.trim() || null,
        groupName: r.group_name,
        departmentName: r.department_name,
        senderName: r.sender_name,
        sentAt: r.sent_at,
        ...(opts.deleted
          ? { daysLeft: r.days_left ?? 0, deletedByName: r.deleted_by_name }
          : {}),
      })),
      total: kind ? countMap[kind] : countMap.all,
      counts: countMap,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  /**
   * 取檔案內容。經 RLS + 部門範圍確認後才去 R2 拿，網址本身不外流（FMEA F-2）。
   */
  async content(mediaId: string): Promise<{ body: Buffer; contentType: string; filename: string | null }> {
    const tx = currentTx();
    const res = await tx.execute<{
      storage_key: string; content_type: string | null; original_filename: string | null;
    }>(sql`
      SELECT md.storage_key, md.content_type, md.original_filename
        FROM line_media md
        JOIN line_message m ON m.message_id = md.message_id
       WHERE md.media_id = ${mediaId}::uuid
         AND md.storage_key IS NOT NULL
         AND md.purged_at IS NULL          -- 已徹底清除的就是沒有了
         AND ${DEPT_SCOPE}
       LIMIT 1
    `);
    const row = res.rows[0];
    // 查無：不存在、下載失敗、已清除、或不在你的部門範圍 —— 對外一律 404，不透露是哪一種
    if (!row) throw new NotFoundException("找不到這個檔案");

    const body = await this.storage.get(row.storage_key);
    if (!body) throw new NotFoundException("檔案已不在儲存空間中");

    return {
      body,
      contentType: row.content_type ?? "application/octet-stream",
      filename: row.original_filename,
    };
  }

  /**
   * 刪除（隱藏）· 檔案先留著，30 天內可還原。
   *
   * ⚠️ 這只動我們系統裡的副本。LINE 群組裡那則訊息還在 —— bot 沒有權限收回別人發的訊息。
   * 前端文案必須講明，否則使用者會以為群組裡也一起不見了。
   */
  async softDelete(mediaId: string, userId: string, reason: string | null): Promise<{ daysLeft: number }> {
    const tx = currentTx();
    const res = await tx.execute<{ media_id: string }>(sql`
      UPDATE line_media md
         SET deleted_at = now(), deleted_by = ${userId}::uuid, delete_reason = ${reason}
        FROM line_message m
       WHERE m.message_id = md.message_id
         AND md.media_id = ${mediaId}::uuid
         AND md.deleted_at IS NULL
         AND ${DEPT_SCOPE}
       RETURNING md.media_id::text
    `);
    // 改到 0 列＝不存在、已經刪過、或不在權限範圍。三種都回 404，不透露是哪一種。
    if (res.rows.length === 0) throw new NotFoundException("找不到這個檔案，或它已經被刪除了");
    return { daysLeft: RETENTION_DAYS };
  }

  /** 還原 · 只有還沒被清除的才救得回來 */
  async restore(mediaId: string): Promise<void> {
    const tx = currentTx();
    const res = await tx.execute(sql`
      UPDATE line_media md
         SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL
        FROM line_message m
       WHERE m.message_id = md.message_id
         AND md.media_id = ${mediaId}::uuid
         AND md.deleted_at IS NOT NULL
         AND md.purged_at IS NULL
         AND ${DEPT_SCOPE}
       RETURNING md.media_id
    `);
    if (res.rows.length === 0) throw new NotFoundException("找不到可還原的檔案（可能已經徹底清除）");
  }

  /**
   * 徹底清除單一檔案 · 平台端專用（controller 已限 aiproot_admin）。
   * 順序很重要：先抹 R2 再寫 DB。反過來的話，DB 說清掉了但檔案其實還在，
   * 而且不會再有人回來清它 —— 「以為刪了其實沒刪」是這個功能最糟的結局。
   */
  async purge(mediaId: string): Promise<void> {
    const tx = currentTx();
    const res = await tx.execute<{ storage_key: string | null }>(sql`
      SELECT md.storage_key FROM line_media md
       WHERE md.media_id = ${mediaId}::uuid AND md.purged_at IS NULL
       LIMIT 1
    `);
    const row = res.rows[0];
    if (!row) throw new NotFoundException("找不到這個檔案，或它已經被清除了");

    if (row.storage_key) {
      if (!this.storage.enabled) throw new Error("儲存空間未設定 · 無法清除檔案");
      await this.storage.remove(row.storage_key);
    }
    await tx.execute(sql`
      UPDATE line_media
         SET purged_at = now(), storage_key = NULL,
             deleted_at = COALESCE(deleted_at, now())
       WHERE media_id = ${mediaId}::uuid
    `);
  }

}

function isKind(v: unknown): v is MediaKind {
  return v === "image" || v === "video" || v === "audio" || v === "file";
}
