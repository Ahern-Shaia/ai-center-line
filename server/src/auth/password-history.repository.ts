import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { PASSWORD_POLICY } from "./password-policy.service.js";

@Injectable()
export class PasswordHistoryRepository {
  // 檢查候選密碼是否在最近 N 筆歷史內
  async isReused(tx: Db, userId: string, candidate: string): Promise<boolean> {
    const res = await tx.execute<{ password_hash: string }>(sql`
      SELECT password_hash FROM password_history
      WHERE user_id = ${userId}
      ORDER BY set_at DESC
      LIMIT ${PASSWORD_POLICY.HISTORY_KEEP}
    `);
    for (const row of res.rows) {
      if (await bcrypt.compare(candidate, row.password_hash)) return true;
    }
    return false;
  }

  // 加新 hash 到歷史 · 順手 GC 舊筆（保留最近 N）
  async add(tx: Db, userId: string, passwordHash: string): Promise<void> {
    await tx.execute(sql`
      INSERT INTO password_history (user_id, password_hash) VALUES (${userId}, ${passwordHash})
    `);
    // GC 舊 · 用 window function 找超過 N 筆的舊 record 刪掉
    await tx.execute(sql`
      DELETE FROM password_history
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY set_at DESC) AS rn
          FROM password_history WHERE user_id = ${userId}
        ) t
        WHERE t.rn > ${PASSWORD_POLICY.HISTORY_KEEP}
      )
    `);
  }
}
