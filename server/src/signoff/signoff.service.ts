import { Injectable } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { currentTx } from "../db/client.js";
import { tickets } from "../db/schema.js";

@Injectable()
export class SignoffService {
  // 當日待簽核 tickets。RLS 自動限本租戶／本部門，不需手動加 where tenant_id。
  async pending() {
    const tx = currentTx();
    return tx
      .select({
        ticketId: tickets.ticketId,
        summary: tickets.summary,
        confidence: tickets.confidence,
        departmentId: tickets.departmentId,
        needsReview: tickets.needsReview,
      })
      .from(tickets)
      .where(eq(tickets.confirmStatus, "待簽核"));
  }

  // 簽核狀態機：待簽核 → 已簽核。低信心(needs_review)須補件才可簽（擋下、回報）。
  // RLS 保證只能簽本租戶／本部門看得到的單。Outbox→Ragic 為 production（demo 暫不接）。
  async confirm(userId: string, ticketIds: string[]) {
    const tx = currentTx();
    const confirmed: string[] = [];
    const blocked: { ticket_id: string; reason: string }[] = [];
    const skipped: string[] = [];
    if (!ticketIds.length) return { confirmed, blocked, skipped };

    const rows = await tx
      .select({ id: tickets.ticketId, status: tickets.confirmStatus, needsReview: tickets.needsReview })
      .from(tickets)
      .where(inArray(tickets.ticketId, ticketIds));
    const byId = new Map(rows.map((r) => [r.id, r]));

    const toConfirm: string[] = [];
    for (const id of ticketIds) {
      const r = byId.get(id);
      if (!r) { skipped.push(id); continue; } // RLS 範圍外或不存在
      if (r.status !== "待簽核") { skipped.push(id); continue; } // 已簽或逾時
      if (r.needsReview) { blocked.push({ ticket_id: id, reason: "低信心，須補件才可簽核" }); continue; }
      toConfirm.push(id);
    }

    if (toConfirm.length) {
      await tx
        .update(tickets)
        .set({ confirmStatus: "已簽核", confirmedBy: userId, confirmedAt: new Date() })
        .where(inArray(tickets.ticketId, toConfirm));
      confirmed.push(...toConfirm);
    }
    return { confirmed, blocked, skipped };
  }
}
