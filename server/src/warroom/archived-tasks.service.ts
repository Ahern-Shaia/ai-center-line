// 存查頁 · 分頁＋日期／群組篩選（台灣福祉 ⑥ · M3b）
//
// ⭐ 為什麼要獨立一支，不是把看板那份切得多一點：
//
//   看板走的是「撈最近 500 筆 → 用 JS 分堆 → 存查取前 50」。
//   對存查來說這是**兩層天花板**，而且外層那層更糟：
//   一個租戶累積超過 500 張票之後，較舊的存查紀錄**根本沒被撈進來**，
//   連「共 N 筆」都是錯的（N 只算得到那 500 筆裡的）。
//
//   存查的用途正好是「找回三個月前那件事」——
//   它是唯一一個**必須看得到舊資料**的頁面，卻掛在一個以「最近」為前提的查詢下面。
//
// 篩選條件與素材看板同一組（日期＋群組 · 用戶 2026-08-25 裁定），
// 三個同款陷阱的處理見 media.service.ts 與 media-filters.test.ts。
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";
import { TaskConfigService } from "../task-config/task-config.service.js";
import { likeContains } from "../common/query-like.js";
import { TICKET_SELECT, TICKET_FROM, makeTicketMapper, type TicketRow } from "./ticket-row.js";
import type { WarroomTicket } from "./warroom-tasks.service.js";

/** 群組選項 · 只列真的有存查紀錄的群 */
export interface ArchiveGroupOption {
  groupId: string;
  name: string;
}

export interface ArchivedListResult {
  items: WarroomTicket[];
  total: number;
  groups: ArchiveGroupOption[];
  page: number;
  pageSize: number;
}

export interface ArchivedListOpts {
  page?: number;
  /** YYYY-MM-DD（台灣時間的那一天）· controller 已驗過格式 */
  from?: string | null;
  to?: string | null;
  /** LINE group id（Cxxx…）*/
  groupId?: string | null;
  /** 關鍵字 · 比對任務摘要 · controller 已 trim 過 */
  q?: string | null;
}

const PAGE_SIZE = 50;

/**
 * 存查＝「公告 / 已完成」與主管標「不用追」的。
 * 兩種都留著可查、可改回待辦 —— 標了不用追就徹底消失的話，按錯了沒有補救途徑（doc F-1 · P0）。
 */
const ARCHIVED = sql`t.confirm_status IN ('存查', '已忽略')`;

@Injectable()
export class ArchivedTasksService {
  constructor(private readonly taskConfig: TaskConfigService) {}

  async list(opts: ArchivedListOpts = {}): Promise<ArchivedListResult> {
    const tx = currentTx();
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const offset = (page - 1) * PAGE_SIZE;
    const from = opts.from || null;
    const to = opts.to || null;
    const groupId = opts.groupId || null;
    const like = opts.q ? likeContains(opts.q) : null;

    // 日期以**台灣時間的那一天**為準。created_at 存 UTC，直接 ::date 比會讓
    // 台灣早上 8 點前建立的票算成前一天 —— 使用者選「今天」看不到今早的紀錄。
    // 與 media.service.ts 同一個寫法，兩頁的「一天」要是同一個定義。
    const FILTER = sql`(
          (${from}::date    IS NULL OR (t.created_at AT TIME ZONE 'Asia/Taipei')::date >= ${from}::date)
      AND (${to}::date      IS NULL OR (t.created_at AT TIME ZONE 'Asia/Taipei')::date <= ${to}::date)
      AND (${groupId}::text IS NULL OR su.group_id = ${groupId}::text)
      AND (${like}::text IS NULL OR t.summary ILIKE ${like})
    )`;

    // total 要吃同一組篩選 —— 不然頁碼會算出根本翻不到的頁數
    const cnt = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n ${TICKET_FROM} WHERE ${ARCHIVED} AND ${FILTER}
    `);
    const total = cnt.rows[0]?.n ?? 0;

    // 群組選項刻意**不吃**日期與群組篩選：
    // 選項會隨條件消失的下拉，選下去就再也切不回來。
    const groupRows = await tx.execute<{ group_id: string; name: string | null }>(sql`
      SELECT su.group_id, max(lg.display_name) AS name
        ${TICKET_FROM}
       WHERE ${ARCHIVED} AND su.group_id IS NOT NULL
         AND su.group_id NOT LIKE '\\_\\_personal\\_\\_%'
       GROUP BY su.group_id
       ORDER BY 2
    `);

    const rows = await tx.execute<TicketRow>(sql`
      ${TICKET_SELECT}
      WHERE ${ARCHIVED} AND ${FILTER}
      ORDER BY t.created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `);

    const { graceDays } = await this.taskConfig.forCurrentTenant(tx);
    const toTicket = makeTicketMapper(graceDays, Date.now());

    return {
      items: rows.rows.map(toTicket) as WarroomTicket[],
      total,
      groups: groupRows.rows.map((r) => ({
        groupId: r.group_id,
        name: r.name?.trim() || `未命名群組 ⋯${r.group_id.slice(-6)}`,
      })),
      page,
      pageSize: PAGE_SIZE,
    };
  }
}
