import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { AUDIT_ACTOR_LABEL as ROLE_LABEL } from "../auth/role-label.js";
import { currentTx } from "../db/client.js";
import { msg } from "../i18n/index.js";

// 稽核記錄 · 讀 audit_log（TenantTxInterceptor 每個請求寫一筆 · CLAUDE.md R5）
//
// 這頁在 2026-07-28 之前顯示的是編造的稽核事件（含假的 IP、假的對象、假的部門）。
// 合規性質的頁面顯示編造的紀錄，比顯示「尚無資料」危險得多。
//
// 真實資料比原本的假資料粗糙，這裡不粉飾：
//   · ip / target_id 從來沒有被寫入 → 這兩欄直接不做，不要放空欄位假裝有
//   · action 是「GET /warroom」這種原始路徑 → 轉成看得懂的中文（見 describe）
//   · 對不到的路徑保留原文，不硬掰。看到原文就是該補對照表了

export interface AuditItem {
  id: string;
  at: string;
  actorName: string | null;
  actorRole: string | null;
  /** 中文動作描述 · 對不到就是原始路徑 */
  action: string;
  /** 是否為變更類（非 GET）· 前端用來標色 */
  isWrite: boolean;
  result: string;
}

export type AuditScope = "all" | "write" | "login";

const PAGE_SIZE = 50;



// 路徑前綴 → 中文。長的排前面，比對取第一個命中。
const PATH_LABEL: [string, string][] = [
  ["POST /auth/login", "srv.audit.act.post-auth-login"],
  ["POST /auth/change-password", "srv.audit.act.post-auth-change-password"],
  ["GET /warroom/daily-reports", "srv.audit.act.get-warroom-daily-reports"],
  ["GET /warroom/tickets/…/source", "srv.audit.act.get-warroom-tickets-source"],
  ["PATCH /warroom/tickets/…/assignee", "srv.audit.act.patch-warroom-tickets-assignee"],
  ["GET /warroom/assignable-members", "srv.audit.act.get-warroom-assignable-members"],
  ["GET /warroom/group-messages", "srv.audit.act.get-warroom-group-messages"],
  ["POST /warroom/batches", "srv.audit.act.post-warroom-batches"],
  ["GET /warroom/tasks", "srv.audit.act.get-warroom-tasks"],
  ["GET /warroom", "srv.audit.act.get-warroom"],
  ["POST /signoff", "srv.audit.act.post-signoff"],
  ["GET /signoff", "srv.audit.act.get-signoff"],
  ["GET /media/…/content", "srv.audit.act.get-media-content"],
  ["GET /media", "srv.audit.act.get-media"],
  ["GET /me/permissions", "srv.audit.act.get-me-permissions"],
  ["POST /personal-daily-report", "srv.audit.act.post-personal-daily-report"],
  ["GET /personal-daily-report", "srv.audit.act.get-personal-daily-report"],
  ["POST /attendance", "srv.audit.act.post-attendance"],
  ["PATCH /attendance", "srv.audit.act.patch-attendance"],
  ["GET /attendance", "srv.audit.act.get-attendance"],
  ["POST /conversation-analysis", "srv.audit.act.post-conversation-analysis"],
  ["GET /conversation-analysis", "srv.audit.act.get-conversation-analysis"],
  ["GET /tenant-admin", "srv.audit.act.get-tenant-admin"],
  ["POST /tenant-admin", "srv.audit.act.post-tenant-admin"],
  ["PATCH /tenant-admin", "srv.audit.act.patch-tenant-admin"],
  ["DELETE /tenant-admin", "srv.audit.act.delete-tenant-admin"],
  ["POST /tenant-provisioning/users/…/reset-password", "srv.audit.act.post-tenant-provisioning-users-reset-password"],
  ["POST /tenant-provisioning", "srv.audit.act.post-tenant-provisioning"],
  ["GET /permissions", "srv.audit.act.get-permissions"],
  ["PATCH /permissions", "srv.audit.act.patch-permissions"],
  ["GET /roles", "srv.audit.act.get-roles"],
  ["POST /roles", "srv.audit.act.post-roles"],
  ["GET /audit", "srv.audit.act.get-audit"],
  ["GET /line-groups", "srv.audit.act.get-line-groups"],
  ["PATCH /line-groups", "srv.audit.act.patch-line-groups"],
  ["GET /line-bots", "srv.audit.act.get-line-bots"],
  ["GET /notify-config", "srv.audit.act.get-notify-config"],
  ["POST /notify-config", "srv.audit.act.post-notify-config"],
  ["PATCH /notify-config", "srv.audit.act.patch-notify-config"],
  ["GET /scheduler-config", "srv.audit.act.get-scheduler-config"],
  ["PATCH /scheduler-config", "srv.audit.act.patch-scheduler-config"],
  ["GET /binding", "srv.audit.act.get-binding"],
  ["GET /llm-config", "srv.audit.act.get-llm-config"],
  ["PATCH /llm-config", "srv.audit.act.patch-llm-config"],
  ["PUT /llm-config", "srv.audit.act.put-llm-config"],
  ["GET /aiproot-console", "srv.audit.act.get-aiproot-console"],
  ["POST /aiproot-console", "srv.audit.act.post-aiproot-console"],
  ["PATCH /aiproot-console", "srv.audit.act.patch-aiproot-console"],
];

/** 「GET /line-bots/75c149e5-…?x=1」→「GET /line-bots/…」→ 依請求語言的說明文字 */
function describe(raw: string): string {
  const noQuery = raw.split("?")[0];
  const normalized = noQuery.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "/…",
  );
  for (const [prefix, label] of PATH_LABEL) {
    if (normalized.startsWith(prefix)) return msg(label);
  }
  return normalized;
}

@Injectable()
export class AuditService {
  async list(opts: { scope?: AuditScope; page?: number } = {}) {
    const tx = currentTx();
    const scope: AuditScope = opts.scope ?? "all";
    const page = Math.max(1, Math.floor(opts.page ?? 1));

    // 多撈一筆判斷有沒有下一頁 —— audit_log 每個請求寫一筆，
    // 算 count(*) 會隨使用時間愈來愈慢，而使用者只需要知道能不能翻下一頁。
    const res = await tx.execute<{
      id: string; created_at: string; action: string; result: string;
      actor_role: string | null; actor_name: string | null;
    }>(sql`
      SELECT a.id::text,
             to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
             a.action, a.result, a.actor_role,
             -- display_name 常為 null（多數帳號沒設暱稱）→ fallback email 前綴，
             -- 對齊 topbar 的「暱稱否則 email 前綴」，避免「使用者」整欄顯示「—」
             COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)) AS actor_name
        FROM audit_log a
        LEFT JOIN users u ON u.user_id = a.actor_user_id
       WHERE (${scope}::text = 'all'
              OR (${scope}::text = 'write'  AND a.action NOT LIKE 'GET %')
              OR (${scope}::text = 'login'  AND a.action LIKE 'POST /auth/login%'))
       ORDER BY a.id DESC
       LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}
    `);

    const hasNext = res.rows.length > PAGE_SIZE;
    const items: AuditItem[] = res.rows.slice(0, PAGE_SIZE).map((r) => ({
      id: r.id,
      at: r.created_at,
      actorName: r.actor_name,
      actorRole: r.actor_role ? (ROLE_LABEL[r.actor_role] ? msg(ROLE_LABEL[r.actor_role]) : r.actor_role) : null,
      action: describe(r.action),
      isWrite: !r.action.startsWith("GET "),
      result: r.result === "denied" ? "已擋下" : "成功",  // ⚠️ 前端 audit.res.* 對照表的 key · 這裡是識別字不是文案
    }));

    return { items, page, pageSize: PAGE_SIZE, hasNext };
  }
}
