import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { resolveTenantId } from "../auth/resolve-tenant-id.js";
import { currentTx } from "../db/client.js";
import { RagicAccountRepository } from "../ragic/ragic-account.repository.js";
import { MasterDataRepository } from "./master-data.repository.js";
import { MasterDataSyncService } from "./master-data-sync.service.js";
import { AllowAnyUser } from "../auth/allow-any-user.decorator.js";

// 主檔（客戶名冊）· docs/modules/master-data-sync.md
//
// ⚠️ 設定端限我方（aiproot / consultant），與「通知設定」一致。
// 理由不是不想開放給客戶，而是**兩者共用同一組 Ragic 憑證**：
// ragic_account 的 RLS 只認 aiproot_admin / consultant / system，
// 給 tenant_admin 開了設定頁，他會看到空白的帳號清單卻不知道為什麼 ——
// 那比不給他看更糟。要開放給客戶方是一個獨立的決定（連 ragic_account 的 RLS 一起改）。
//
// ⚠️ 0051 起改用權限碼 `master-data:manage`，不再用 @Roles 列舉角色。
//    原因是側邊欄用權限碼決定顯不顯示、後端用角色白名單決定放不放行，
//    兩套對不上時的下場是：選單看得到、點進去 403、畫面渲染成「0 筆客戶」。
//    助理角色實際踩到過。**新端點一律用權限碼，不要再開角色白名單。**

@Controller("master-data")
export class MasterDataController {
  constructor(
    private readonly repo: MasterDataRepository,
    private readonly sync: MasterDataSyncService,
    private readonly accounts: RagicAccountRepository,
  ) {}

  /**
   * 目前設定 + 已連線的 Ragic 帳號（不用客戶再連一次 · §1.1）
   *
   * ⚠️ aiproot / consultant 是平台級帳號、JWT 沒有 tenant_id，
   * 所以要由畫面指定在設哪一家（同其他跨租戶頁的做法）。
   */
  @Get("source")
  @RequirePermission("master-data:manage")
  async source(@CurrentUser() user: JwtUser, @Query("tenantId") q?: string) {
    const tx = currentTx();
    const tenantId = resolveTenantId(user, q);
    const [src, count, accounts] = await Promise.all([
      this.repo.getSource(tx, tenantId),
      this.repo.countCustomers(tx, tenantId),
      this.accounts.listForTenant(tx, tenantId),
    ]);
    return { source: src, customerCount: count, ragicAccounts: accounts };
  }

  @Post("source")
  @RequirePermission("master-data:manage")
  async saveSource(@CurrentUser() user: JwtUser, @Body() body: {
    tenantId?: string; provider?: "ragic" | "manual"; accountId?: string | null;
    sheetPath?: string | null; nameField?: string | null; codeField?: string | null;
  }) {
    const tenantId = resolveTenantId(user, body.tenantId);
    const provider = body.provider ?? "ragic";
    if (provider !== "ragic" && provider !== "manual") throw new BadRequestException("provider 不正確");
    if (provider === "ragic") {
      if (!body.accountId) throw new BadRequestException("請選擇 Ragic 帳號");
      if (!body.sheetPath?.trim()) throw new BadRequestException("請填表單路徑");
      if (!body.nameField?.trim()) throw new BadRequestException("請選擇客戶名稱欄位");
    }
    await this.repo.upsertSource(currentTx(), {
      tenantId, kind: "customer", provider,
      accountId: provider === "ragic" ? body.accountId! : null,
      sheetPath: provider === "ragic" ? body.sheetPath!.trim() : null,
      nameField: provider === "ragic" ? body.nameField!.trim() : null,
      codeField: body.codeField?.trim() || null,
    });
    return { success: true };
  }

  @Post("sync")
  @RequirePermission("master-data:manage")
  async syncNow(@CurrentUser() user: JwtUser, @Body() body?: { tenantId?: string }) {
    return this.sync.syncNow(resolveTenantId(user, body?.tenantId));
  }

  /**
   * 客戶候選 · 打卡選單用 —— 任何登入者都要能查，否則同仁選不到客戶。
   * 只回名稱與編號（本來就只存這兩個欄位）。
   */
  @Get("customers")
  @AllowAnyUser()
  async customers(@CurrentUser() user: JwtUser, @Query("q") q?: string) {
    if (!user.tenant_id) return { customers: [] };
    const rows = await this.repo.searchCustomers(currentTx(), user.tenant_id, q ?? "");
    return { customers: rows };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


