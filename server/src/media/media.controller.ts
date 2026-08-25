import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { Roles } from "../auth/roles.decorator.js";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { MediaService } from "./media.service.js";
import { isDate } from "../common/query-date.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 素材看板 · docs/modules/media-and-vision.md §2
// employee 不開放：素材看板是跨群檢視，employee 只看自己的日報。
// 刪除／還原限總經理室以上（用戶 2026-07-28 裁定）· group_owner 只能看
const DELETERS = ["aiproot_admin", "consultant", "tenant_admin"] as const;

@Controller("media")
export class MediaController {
  constructor(private readonly svc: MediaService) {}

  @Get()
  @RequirePermission("media:view")
  async list(
    @Query("kind") kind?: string,
    @Query("page") page?: string,
    @Query("deleted") deleted?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("groupId") groupId?: string,
  ) {
    const p = page ? Number(page) : 1;
    if (!Number.isFinite(p) || p < 1) throw new BadRequestException("page 格式不正確");
    // ⚠️ 日期一定要在這裡擋下來。放行到 SQL 的話 `'2026-13-45'::date` 會是 pg 22008，
    //    使用者拿到的是一個 500 —— 那是我們的錯卻長得像系統壞了。
    if (from && !isDate(from)) throw new BadRequestException("開始日期格式不正確");
    if (to && !isDate(to)) throw new BadRequestException("結束日期格式不正確");
    if (from && to && from > to) throw new BadRequestException("開始日期不能晚於結束日期");
    if (groupId && groupId.length > 128) throw new BadRequestException("群組代碼格式不正確");
    return this.svc.list({ kind, page: p, deleted: deleted === "true", from, to, groupId });
  }

  /** 檔案內容 · 經權限確認後由伺服器代理，R2 網址不外流（FMEA F-2） */
  @Get(":mediaId/content")
  @RequirePermission("media:view")
  async content(@Param("mediaId") mediaId: string, @Res() res: FastifyReply) {
    if (!UUID_RE.test(mediaId)) throw new BadRequestException("mediaId 格式不正確");
    const file = await this.svc.content(mediaId);

    // 檔名走 RFC 5987 · 中文檔名不會壞，也不讓檔名裡的引號/換行有機會插進 header
    const disposition = file.filename
      ? `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`
      : "inline";

    res
      .header("content-type", file.contentType)
      .header("content-disposition", disposition)
      // 內容不可變（一則訊息一個檔），但屬租戶私有 → 只准瀏覽器自己留
      .header("cache-control", "private, max-age=86400")
      .send(file.body);
  }

  /** 刪除（隱藏）· 保留期內可還原。只動我們系統裡的副本，LINE 群組那則訊息還在 */
  @Delete(":mediaId")
  @Roles(...DELETERS)
  async remove(
    @CurrentUser() user: JwtUser,
    @Param("mediaId") mediaId: string,
    @Body() body?: { reason?: string },
  ) {
    if (!UUID_RE.test(mediaId)) throw new BadRequestException("mediaId 格式不正確");
    const reason = body?.reason?.trim().slice(0, 200) || null;
    return this.svc.softDelete(mediaId, user.user_id, reason);
  }

  @Post(":mediaId/restore")
  @Roles(...DELETERS)
  async restore(@Param("mediaId") mediaId: string) {
    if (!UUID_RE.test(mediaId)) throw new BadRequestException("mediaId 格式不正確");
    await this.svc.restore(mediaId);
    return { success: true };
  }

  /**
   * 立即徹底清除 · 只有我方平台端能做（用戶 2026-07-28 裁定）。
   * 客戶方最多只能刪到「隱藏」，真的要抹掉個資時找我們 —— 不可逆的操作收在一個窗口。
   */
  @Post(":mediaId/purge")
  @Roles("aiproot_admin")
  async purge(@Param("mediaId") mediaId: string) {
    if (!UUID_RE.test(mediaId)) throw new BadRequestException("mediaId 格式不正確");
    await this.svc.purge(mediaId);
    return { success: true };
  }
}
