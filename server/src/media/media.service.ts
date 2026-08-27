import { Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";
import { MediaStorageService } from "../line-ingest/media-storage.service.js";
import { likeContains } from "../common/query-like.js";
import { msg } from "../i18n/index.js";

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

/** 群組篩選的下拉選項 · 只列真的有檔案的群（列了空群只是雜訊） */
export interface MediaGroupOption {
  groupId: string;
  name: string;
}

export interface MediaListResult {
  items: MediaItem[];
  /** 篩選後的筆數 —— 有篩選時前端文案要跟著改，不然會被讀成「總共只有這麼多」 */
  total: number;
  counts: Record<MediaKind | "all", number>;
  groups: MediaGroupOption[];
  page: number;
  pageSize: number;
}

export interface MediaListOpts {
  kind?: string;
  page?: number;
  deleted?: boolean;
  /** YYYY-MM-DD（台灣時間的那一天）· controller 已驗過格式 */
  from?: string | null;
  to?: string | null;
  /** LINE group id（Cxxx…）· 不是 group_registry_id */
  groupId?: string | null;
  /** 關鍵字 · 比對檔名與「前後三分鐘的文字訊息」· controller 已 trim 過 */
  q?: string | null;
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

  async list(opts: MediaListOpts = {}): Promise<MediaListResult> {
    const tx = currentTx();
    const kind = isKind(opts.kind) ? opts.kind : null;
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const offset = (page - 1) * PAGE_SIZE;
    const from = opts.from || null;
    const to = opts.to || null;
    const groupId = opts.groupId || null;
    const like = opts.q ? likeContains(opts.q) : null;
    // 已刪除清單只列「還救得回來」的：purged 之後檔案已經不在，列出來也還原不了
    const state = opts.deleted
      ? sql`md.deleted_at IS NOT NULL AND md.purged_at IS NULL`
      : sql`md.deleted_at IS NULL`;

    // 日期以**台灣時間的那一天**為準。sent_at 存 UTC，直接拿 ::date 比會讓
    // 早上 8 點前傳的檔案算成前一天 —— 使用者選「今天」卻看不到今天早上的圖。
    // （同款時區踩坑見 AGENTS.md；attendance / line-message 也都是這樣寫的）
    const FILTER = sql`(
          (${from}::date    IS NULL OR (m.sent_at AT TIME ZONE 'Asia/Taipei')::date >= ${from}::date)
      AND (${to}::date      IS NULL OR (m.sent_at AT TIME ZONE 'Asia/Taipei')::date <= ${to}::date)
      AND (${groupId}::text IS NULL OR m.group_id = ${groupId}::text)
      AND (${like}::text IS NULL OR
           -- 照片多半沒有檔名（LINE 只有 file 型別才給），所以光比對檔名幾乎搜不到東西。
           -- 真正有用的是「有人在這張圖前後講了什麼」——「報價單」通常打在訊息裡不在檔名裡。
           md.original_filename ILIKE ${like}
           OR EXISTS (SELECT 1 FROM line_message t
                       WHERE t.group_id = m.group_id
                         AND t.message_type = 'text'
                         AND t.sent_at BETWEEN m.sent_at - interval '3 minutes'
                                           AND m.sent_at + interval '3 minutes'
                         AND t.text_content ILIKE ${like}))
    )`;

    // ⚠️ counts 一定要吃同一組篩選 —— 不然分頁籤寫「圖片 135」點下去只有 3 張，
    //    使用者會以為篩選壞了。分頁籤的數字就是「這組條件下各類型有幾個」。
    const counts = await tx.execute<{ media_type: MediaKind; n: number }>(sql`
      SELECT md.media_type, count(*)::int AS n
        FROM line_media md
        JOIN line_message m ON m.message_id = md.message_id
       WHERE md.storage_key IS NOT NULL AND ${DEPT_SCOPE} AND ${state} AND ${FILTER}
       GROUP BY 1
    `);

    // 群組選項刻意**不吃**日期與群組篩選 —— 選項會隨著選日期而消失的下拉很難用，
    // 而且選了某一群之後就剩它自己，等於再也切不回去。
    // INNER JOIN line_group：1:1 私訊的 group_id 是 `__personal__<userId>` 佔位，
    // 不是群組，列進下拉只會是一串亂碼。
    const groupRows = await tx.execute<{ group_id: string; name: string | null }>(sql`
      SELECT m.group_id, max(g.display_name) AS name
        FROM line_media md
        JOIN line_message m ON m.message_id = md.message_id
        JOIN line_group g   ON g.group_id = m.group_id
       WHERE md.storage_key IS NOT NULL AND ${DEPT_SCOPE} AND ${state}
       GROUP BY m.group_id
       ORDER BY 2
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
         AND ${FILTER}
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
      // 沒設定群組名稱的群回傳 group_id 尾碼 —— 給空字串的話下拉會有一個點不出所以然的空白項
      groups: groupRows.rows.map((r) => ({
        groupId: r.group_id,
        name: r.name?.trim() || `未命名群組 ⋯${r.group_id.slice(-6)}`,
      })),
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
    if (!row) throw new NotFoundException(msg("srv.media.notFound"));

    const body = await this.storage.get(row.storage_key);
    if (!body) throw new NotFoundException(msg("srv.media.gone"));

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
    if (res.rows.length === 0) throw new NotFoundException(msg("srv.media.deleted"));
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
    if (res.rows.length === 0) throw new NotFoundException(msg("srv.media.noRestorable"));
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
    if (!row) throw new NotFoundException(msg("srv.media.purged"));

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
