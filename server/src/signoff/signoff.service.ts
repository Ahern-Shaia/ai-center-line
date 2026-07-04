import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { currentTx } from "../db/client.js";
import { tickets } from "../db/schema.js";

@Injectable()
export class SignoffService {
  // 當日待簽核 tickets。查詢用 currentTx()（租戶交易）→ RLS 自動限本租戶／本部門，不需手動加 where tenant_id。
  async pending() {
    const tx = currentTx();
    return tx
      .select({
        ticketId: tickets.ticketId,
        summary: tickets.summary,
        confidence: tickets.confidence,
        departmentId: tickets.departmentId,
      })
      .from(tickets)
      .where(eq(tickets.confirmStatus, "待簽核"));
  }
}
