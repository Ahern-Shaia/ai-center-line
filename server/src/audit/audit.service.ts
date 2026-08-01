import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";

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

const ROLE_LABEL: Record<string, string> = {
  aiproot_admin: "平台管理員",
  consultant: "顧問",
  tenant_admin: "總經理室",
  group_owner: "群組負責人",
  employee: "同仁",
  system: "系統",
};

// 路徑前綴 → 中文。長的排前面，比對取第一個命中。
const PATH_LABEL: [string, string][] = [
  ["POST /auth/login", "登入"],
  ["POST /auth/change-password", "變更密碼"],
  ["GET /warroom/daily-reports", "查看今日日誌"],
  ["GET /warroom/tickets/…/source", "查看任務來源"],
  ["PATCH /warroom/tickets/…/assignee", "派發任務"],
  ["GET /warroom/assignable-members", "查看可指派成員"],
  ["GET /warroom/group-messages", "查看群組原始訊息"],
  ["POST /warroom/batches", "手動觸發分析"],
  ["GET /warroom/tasks", "查看任務看板"],
  ["GET /warroom", "查看總覽儀表"],
  ["POST /signoff", "每日簽核"],
  ["GET /signoff", "查看待簽核"],
  ["GET /media/…/content", "開啟檔案"],
  ["GET /media", "查看素材看板"],
  ["GET /me/permissions", "載入權限"],
  ["POST /personal-daily-report", "送出個人日報"],
  ["GET /personal-daily-report", "查看個人日報"],
  ["POST /attendance", "外勤打卡"],
  ["PATCH /attendance", "修改外勤紀錄"],
  ["GET /attendance", "查看外勤紀錄"],
  ["POST /conversation-analysis", "上傳對話分析"],
  ["GET /conversation-analysis", "查看對話分析"],
  ["GET /tenant-admin", "查看部門與成員"],
  ["POST /tenant-admin", "變更部門或成員"],
  ["PATCH /tenant-admin", "變更部門或成員"],
  ["DELETE /tenant-admin", "刪除部門或成員"],
  ["POST /tenant-provisioning/users/…/reset-password", "重設同仁密碼"],
  ["POST /tenant-provisioning", "開通帳號"],
  ["GET /permissions", "查看權限設定"],
  ["PATCH /permissions", "變更權限設定"],
  ["GET /roles", "查看角色設定"],
  ["POST /roles", "變更角色設定"],
  ["GET /audit", "查看稽核記錄"],
  ["GET /line-groups", "查看 LINE 群組"],
  ["PATCH /line-groups", "變更 LINE 群組設定"],
  ["GET /line-bots", "查看 LINE 設定"],
  ["GET /notify-config", "查看通知設定"],
  ["POST /notify-config", "變更通知設定"],
  ["PATCH /notify-config", "變更通知設定"],
  ["GET /scheduler-config", "查看定時任務"],
  ["PATCH /scheduler-config", "變更定時任務"],
  ["GET /binding", "查看 LINE 綁定"],
  ["GET /llm-config", "查看語言模型設定"],
  ["PATCH /llm-config", "變更語言模型設定"],
  ["PUT /llm-config", "變更語言模型設定"],
  ["GET /aiproot-console", "查看平台管理"],
  ["POST /aiproot-console", "變更平台設定"],
  ["PATCH /aiproot-console", "變更平台設定"],
];

/** 「GET /line-bots/75c149e5-…?x=1」→「GET /line-bots/…」→ 中文 */
function describe(raw: string): string {
  const noQuery = raw.split("?")[0];
  const normalized = noQuery.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "/…",
  );
  for (const [prefix, label] of PATH_LABEL) {
    if (normalized.startsWith(prefix)) return label;
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
      actorRole: r.actor_role ? ROLE_LABEL[r.actor_role] ?? r.actor_role : null,
      action: describe(r.action),
      isWrite: !r.action.startsWith("GET "),
      result: r.result === "denied" ? "已擋下" : "成功",
    }));

    return { items, page, pageSize: PAGE_SIZE, hasNext };
  }
}
