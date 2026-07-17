import { Injectable, Logger } from "@nestjs/common";
import { LineClient } from "./line.client.js";
import { NotifyRepository } from "./notify.repository.js";
import { MemoryDedupCache, type DedupCache } from "./dedup.js";
import { composeMaintenanceReportMessage } from "./compose/compose-maintenance-report.js";
import { composeAnalysisSheetMessage } from "./compose/compose-analysis-sheet.js";
import { composeQuotationMessage } from "./compose/compose-quotation.js";
import { composeMaterialInspectionMessage } from "./compose/compose-material-inspection.js";
import type { RagicMaintenanceReportPayload } from "./dto/ragic-maintenance-report.dto.js";
import type { RagicAnalysisSheetPayload } from "./dto/ragic-analysis-sheet.dto.js";
import type { RagicQuotationPayload } from "./dto/ragic-quotation.dto.js";
import type { RagicMaterialInspectionPayload } from "./dto/ragic-material-inspection.dto.js";
import type { TenantConfig } from "./tenant.registry.js";

export interface HandleResult {
  status: "sent" | "skipped_dedup" | "line_failed" | "sheet_not_allowed";
  requestId?: string;
  lineStatus?: number;
  lineMessage?: string;
}

// 通用 payload 頂層欄位（Maintenance / Analysis / 未來新 sheet 共用）
interface NotifyCommon {
  trigger: "save" | "button";
  sheetPath: string;
  sheetName?: string;
  recordUrl?: string;
  timestamp?: number;
  recordId: number;
}

// 編排：sheet 白名單 → dedup → compose → LINE push → audit log。
// M2 起全流程 tenant-aware（notify-multi-tenant.md §5）。
// dedup 是 in-memory；backend 單 replica 假設下有效（Phase 1 §6.2）。
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);
  // dedup 直接在類別欄位建立 default；不從 DI 注入（interface 無 runtime metadata）。
  // 測試要換：直接改本欄或用 setDedupCache（僅測試用）。
  private dedup: DedupCache = new MemoryDedupCache(30_000);

  constructor(
    private readonly lineClient: LineClient,
    private readonly repo: NotifyRepository,
  ) {}

  /** 僅測試用：注入 fake dedup cache（生產不用） */
  setDedupCache(cache: DedupCache): void {
    this.dedup = cache;
  }

  async handleMaintenanceReport(
    tenant: TenantConfig,
    payload: RagicMaintenanceReportPayload,
  ): Promise<HandleResult> {
    return this.handle(tenant, payload, (rec, trigger) =>
      composeMaintenanceReportMessage(rec, trigger, payload.sheetName, payload.recordUrl),
    );
  }

  async handleAnalysisSheet(
    tenant: TenantConfig,
    payload: RagicAnalysisSheetPayload,
  ): Promise<HandleResult> {
    return this.handle(tenant, payload, (rec, trigger) =>
      composeAnalysisSheetMessage(rec, trigger, payload.sheetName, payload.recordUrl),
    );
  }

  async handleQuotation(
    tenant: TenantConfig,
    payload: RagicQuotationPayload,
  ): Promise<HandleResult> {
    return this.handle(tenant, payload, (rec, trigger) =>
      composeQuotationMessage(rec, trigger, payload.sheetName, payload.recordUrl),
    );
  }

  async handleMaterialInspection(
    tenant: TenantConfig,
    payload: RagicMaterialInspectionPayload,
  ): Promise<HandleResult> {
    return this.handle(tenant, payload, (rec, trigger) =>
      composeMaterialInspectionMessage(rec, trigger, payload.sheetName, payload.recordUrl),
    );
  }

  // 通用編排邏輯（白名單 / timestamp / dedup / compose / LINE push / audit log）
  private async handle<P extends NotifyCommon & { record: any }>(
    tenant: TenantConfig,
    payload: P,
    composer: (rec: P["record"], trigger: "save" | "button") => string,
  ): Promise<HandleResult> {
    const startedAt = Date.now();
    const { trigger, sheetPath, recordId, record, timestamp } = payload;

    // 0) Sheet path 白名單（notify-multi-tenant.md §4.4）
    //    allowedSheetPaths 空陣列 = 未設 env = 允許所有（back-compat 台灣福祉）
    //    非空 = 只允許陣列內的（鮮勇明列 tenant sheet 白名單）
    if (tenant.allowedSheetPaths.length > 0 && !tenant.allowedSheetPaths.includes(sheetPath)) {
      this.logger.warn(
        `拒絕 cross-tenant sheet path: tenant=${tenant.slug} sheetPath=${sheetPath}（不在白名單）`,
      );
      const logged = await this.repo.writeLog({
        tenantId: tenant.slug,
        trigger, sheetPath, recordId,
        status: "sheet_not_allowed",
        latencyMs: Date.now() - startedAt,
        audit: { reason: "sheet_not_in_tenant_allowlist", allowed: tenant.allowedSheetPaths },
      });
      return { status: "sheet_not_allowed", requestId: logged?.requestId };
    }

    // 1) Replay attack 緩解（notify.md §12 E5）：payload 帶 timestamp 就檢查 ±5 分鐘窗
    //    不帶（backward compat）→ 記 warning 但放行；由 dedup 30s + audit log 兜底
    if (timestamp != null) {
      const drift = Math.abs(startedAt - timestamp);
      const MAX_DRIFT_MS = 5 * 60 * 1000;
      if (drift > MAX_DRIFT_MS) {
        this.logger.warn(
          `拒絕過期 request: tenant=${tenant.slug} sheetPath=${sheetPath} recordId=${recordId} drift=${drift}ms (max=${MAX_DRIFT_MS}ms)`,
        );
        await this.repo.writeLog({
          tenantId: tenant.slug,
          trigger, sheetPath, recordId,
          status: "invalid_body",
          latencyMs: Date.now() - startedAt,
          audit: { reason: "timestamp_out_of_window", drift_ms: drift, max_drift_ms: MAX_DRIFT_MS },
        });
        return { status: "line_failed", lineStatus: 400, lineMessage: `timestamp drift ${drift}ms 超過 5 分鐘窗` };
      }
    }

    // 2) Dedup 30 秒窗（M2 起 key 加 tenant prefix）
    if (this.dedup.shouldSkip(tenant.slug, sheetPath, recordId)) {
      const latencyMs = Date.now() - startedAt;
      const logged = await this.repo.writeLog({
        tenantId: tenant.slug,
        trigger, sheetPath, recordId,
        status: "skipped_dedup",
        latencyMs,
        audit: { reason: "within_30s_window" },
      });
      return { status: "skipped_dedup", requestId: logged?.requestId };
    }

    // 3) Compose 訊息
    const text = composer(record, trigger);

    // 4) Push LINE（stateless：tenant 的 token/group 傳入）
    const lineResult = await this.lineClient.pushText(
      {
        token: tenant.lineChannelToken,
        groupId: tenant.lineGroupIdBusinessAssist,
      },
      text,
    );

    // 5) Audit log
    const latencyMs = Date.now() - startedAt;
    if (lineResult.ok) {
      const logged = await this.repo.writeLog({
        tenantId: tenant.slug,
        trigger, sheetPath, recordId,
        status: "sent",
        latencyMs,
        messageText: text,
        audit: { lineRequestId: lineResult.requestId ?? null },
      });
      return { status: "sent", requestId: logged?.requestId };
    }

    // LINE 失敗：不 retry（OQ-NOT-4 A）
    const logged = await this.repo.writeLog({
      tenantId: tenant.slug,
      trigger, sheetPath, recordId,
      status: "line_failed",
      lineStatus: lineResult.status,
      lineMessage: lineResult.message,
      latencyMs,
      messageText: text,
    });
    this.logger.warn(
      `LINE push failed: tenant=${tenant.slug} status=${lineResult.status} msg=${lineResult.message}`,
    );
    return {
      status: "line_failed",
      requestId: logged?.requestId,
      lineStatus: lineResult.status,
      lineMessage: lineResult.message,
    };
  }
}
