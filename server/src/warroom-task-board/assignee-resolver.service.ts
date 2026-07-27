import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

// 把 AI 抽到的人名文字對到系統帳號 · docs/modules/task-to-personal-report.md §3
//
// 核心原則（doc §2）：**寧可不歸屬，不可歸錯人。**
// 把 A 的工作寫進 B 的日報 = 資料錯誤 + 隱私外洩 + 信任崩塌；
// 不歸屬的代價只是維持現狀（主管手動派）。代價完全不對稱。
//
// 2026-07-27 prod 實測：42 人出現在群組、僅 4 人綁定 LINE（10%）；
// AI 抽到 32 個人名，對得上群名單 11 個（34%）、對得上已綁定 1 個（3%）。
// → 導入期絕大多數會落在 unclaimed，那是**正常主流程**不是失敗：
//   手動派發本來就是 AI 可能認錯時的確認機制。員工陸續綁定後自動歸屬才逐步接手。

export type AssignStatus = "none" | "unclaimed" | "assigned";

export interface ResolveResult {
  status: AssignStatus;
  userId: string | null;
  /** 排查用 · 為什麼沒對到 */
  reason?: "no_name" | "not_in_directory" | "ambiguous" | "not_bound";
}

@Injectable()
export class AssigneeResolverService {
  private readonly logger = new Logger(AssigneeResolverService.name);

  /**
   * 解析單一人名。
   * 只有「唯一命中且已綁定」才回 assigned —— 同名多人一律 unclaimed，不用任何啟發式猜測
   * （猜對沒有獎勵，猜錯要付三種代價 · doc §3.4）。
   */
  async resolve(tx: Db, tenantId: string, rawName: string | null): Promise<ResolveResult> {
    const name = rawName?.trim();
    if (!name) return { status: "none", userId: null, reason: "no_name" };

    // 一次查完：同名的系統帳號（含 LINE 顯示名對應）
    // 兩條路徑：① users.display_name 直接同名 ② line_member.display_name → 綁定 → users
    const res = await tx.execute<{ user_id: string }>(sql`
      SELECT DISTINCT u.user_id::text AS user_id
        FROM users u
       WHERE u.tenant_id = ${tenantId}::uuid
         AND (
           lower(btrim(u.display_name)) = lower(${name})
           OR EXISTS (
             SELECT 1
               FROM user_line_binding b
               JOIN line_member lm ON lm.user_id = b.line_user_id
              WHERE b.user_id = u.user_id
                AND b.status = 'active'
                AND lower(btrim(lm.display_name)) = lower(${name})
           )
         )
       LIMIT 3
    `);

    if (res.rows.length === 1) {
      return { status: "assigned", userId: res.rows[0].user_id };
    }
    if (res.rows.length > 1) {
      // 同名多人 → 不猜（doc §3.4）
      this.logger.log(`歸屬待認領 · 同名多人 · name=${name} tenant=${tenantId}`);
      return { status: "unclaimed", userId: null, reason: "ambiguous" };
    }

    // 有這個人在群裡講過話，但沒綁定 → 這是導入期最常見的情況，值得分開標示
    const inDirectory = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM line_member
       WHERE lower(btrim(display_name)) = lower(${name}) LIMIT 1
    `);
    return {
      status: "unclaimed",
      userId: null,
      reason: (inDirectory.rows[0]?.n ?? 0) > 0 ? "not_bound" : "not_in_directory",
    };
  }

  /**
   * 該租戶「可用於 grounding 的人名候選集」——給抽取階段注入 prompt 用（doc §3.2）。
   * 候選集是該群/該租戶實際存在的人（通常 3–10 人），不是全公司自由發揮，
   * 這樣 LLM 只會輸出名單中的值或 null，避開「阿明/明哥/李明」的別名問題。
   */
  async directory(tx: Db, tenantId: string, limit = 60): Promise<string[]> {
    const res = await tx.execute<{ name: string }>(sql`
      SELECT DISTINCT btrim(name) AS name FROM (
        SELECT u.display_name AS name FROM users u
         WHERE u.tenant_id = ${tenantId}::uuid AND nullif(btrim(u.display_name), '') IS NOT NULL
        UNION
        SELECT lm.display_name FROM line_member lm
         WHERE lm.tenant_id = ${tenantId}::uuid AND nullif(btrim(lm.display_name), '') IS NOT NULL
      ) s
       LIMIT ${limit}
    `);
    return res.rows.map((r) => r.name);
  }
}
