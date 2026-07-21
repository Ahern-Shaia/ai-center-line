import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

// line_group repository · webhook 觸發 upsert · UI 讀列表 · patch department

export interface LineGroupRow {
  groupRegistryId: string;
  botId: string;
  groupId: string;
  displayName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  analyzeEnabled: boolean;
  firstSeenAt: string;
  lastEventAt: string;
  eventCount: number;
  status: "active" | "left";
}

@Injectable()
export class LineGroupRepository {
  // Webhook 觸發 · upsert group · event_count 原子 +1
  async upsertOnEvent(tx: Db, args: {
    botId: string;
    groupId: string;
    eventTimestampMs: number;
    eventType: string;
    rawEvent: Record<string, unknown>;
  }): Promise<{ isNew: boolean }> {
    const ts = new Date(args.eventTimestampMs).toISOString();
    const res = await tx.execute<{ inserted: boolean }>(sql`
      INSERT INTO line_group (bot_id, group_id, first_seen_at, last_event_at, event_count, last_event_raw, status)
      VALUES (${args.botId}, ${args.groupId}, ${ts}, ${ts}, 1, ${JSON.stringify(args.rawEvent)}::jsonb,
        CASE WHEN ${args.eventType} = 'leave' THEN 'left' ELSE 'active' END)
      ON CONFLICT (bot_id, group_id) DO UPDATE SET
        last_event_at = EXCLUDED.last_event_at,
        event_count = line_group.event_count + 1,
        last_event_raw = EXCLUDED.last_event_raw,
        status = CASE
          WHEN ${args.eventType} = 'leave' THEN 'left'
          WHEN ${args.eventType} = 'join' THEN 'active'
          ELSE line_group.status
        END
      RETURNING (xmax = 0) AS inserted
    `);
    return { isNew: res.rows[0]?.inserted ?? false };
  }

  async updateDisplayName(tx: Db, args: { botId: string; groupId: string; displayName: string }): Promise<void> {
    await tx.execute(sql`
      UPDATE line_group SET display_name = ${args.displayName}
      WHERE bot_id = ${args.botId} AND group_id = ${args.groupId}
    `);
  }

  async listByBot(tx: Db, botId: string): Promise<LineGroupRow[]> {
    const res = await tx.execute<{
      group_registry_id: string; bot_id: string; group_id: string;
      display_name: string | null; department_id: string | null;
      department_name: string | null; analyze_enabled: boolean;
      first_seen_at: string; last_event_at: string; event_count: number;
      status: "active" | "left";
    }>(sql`
      SELECT g.group_registry_id, g.bot_id, g.group_id, g.display_name,
             g.department_id, d.department_name, g.analyze_enabled,
             g.first_seen_at::text, g.last_event_at::text, g.event_count, g.status
      FROM line_group g
      LEFT JOIN departments d ON d.department_id = g.department_id
      WHERE g.bot_id = ${botId}
      ORDER BY g.last_event_at DESC
    `);
    return res.rows.map((r) => ({
      groupRegistryId: r.group_registry_id,
      botId: r.bot_id,
      groupId: r.group_id,
      displayName: r.display_name,
      departmentId: r.department_id,
      departmentName: r.department_name,
      analyzeEnabled: r.analyze_enabled,
      firstSeenAt: r.first_seen_at,
      lastEventAt: r.last_event_at,
      eventCount: r.event_count,
      status: r.status,
    }));
  }

  async getById(tx: Db, groupRegistryId: string): Promise<LineGroupRow | null> {
    const res = await tx.execute<{
      group_registry_id: string; bot_id: string; group_id: string;
      display_name: string | null; department_id: string | null;
      department_name: string | null; analyze_enabled: boolean;
      first_seen_at: string; last_event_at: string; event_count: number;
      status: "active" | "left";
    }>(sql`
      SELECT g.group_registry_id, g.bot_id, g.group_id, g.display_name,
             g.department_id, d.department_name, g.analyze_enabled,
             g.first_seen_at::text, g.last_event_at::text, g.event_count, g.status
      FROM line_group g
      LEFT JOIN departments d ON d.department_id = g.department_id
      WHERE g.group_registry_id = ${groupRegistryId}
      LIMIT 1
    `);
    const r = res.rows[0];
    if (!r) return null;
    return {
      groupRegistryId: r.group_registry_id,
      botId: r.bot_id,
      groupId: r.group_id,
      displayName: r.display_name,
      departmentId: r.department_id,
      departmentName: r.department_name,
      analyzeEnabled: r.analyze_enabled,
      firstSeenAt: r.first_seen_at,
      lastEventAt: r.last_event_at,
      eventCount: r.event_count,
      status: r.status,
    };
  }

  // 訊息落庫時查 (botId, groupId) → tenantId + departmentId
  // tenantId 從 line_bot 拉 · departmentId 從 line_group 拉 · 未綁 tenant 回 null → webhook 就丟該訊息
  async getRefForMessage(tx: Db, botId: string, groupId: string): Promise<{
    tenantId: string | null;
    departmentId: string | null;
  } | null> {
    const res = await tx.execute<{ tenant_id: string | null; department_id: string | null }>(sql`
      SELECT b.tenant_id, g.department_id
      FROM line_group g
      JOIN line_bot b ON b.bot_id = g.bot_id
      WHERE g.bot_id = ${botId} AND g.group_id = ${groupId}
      LIMIT 1
    `);
    const r = res.rows[0];
    if (!r) return null;
    return { tenantId: r.tenant_id, departmentId: r.department_id };
  }

  async patchAssignment(tx: Db, groupRegistryId: string, patch: {
    departmentId?: string | null;
    displayName?: string;
    analyzeEnabled?: boolean;
  }): Promise<void> {
    await tx.execute(sql`
      UPDATE line_group SET
        department_id = CASE WHEN ${patch.departmentId !== undefined}::boolean
          THEN ${patch.departmentId ?? null} ELSE department_id END,
        display_name = COALESCE(${patch.displayName ?? null}, display_name),
        analyze_enabled = COALESCE(${patch.analyzeEnabled ?? null}, analyze_enabled)
      WHERE group_registry_id = ${groupRegistryId}
    `);
  }
}
