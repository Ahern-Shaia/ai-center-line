import { BadRequestException, Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Roles } from "../auth/roles.decorator.js";
import { MediaService } from "./media.service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 素材看板 · docs/modules/media-and-vision.md §2
// employee 不開放：素材看板是跨群檢視，employee 只看自己的日報。
const VIEWERS = ["aiproot_admin", "consultant", "tenant_admin", "group_owner"] as const;

@Controller("media")
export class MediaController {
  constructor(private readonly svc: MediaService) {}

  @Get()
  @Roles(...VIEWERS)
  async list(@Query("kind") kind?: string, @Query("page") page?: string) {
    const p = page ? Number(page) : 1;
    if (!Number.isFinite(p) || p < 1) throw new BadRequestException("page 格式不正確");
    return this.svc.list({ kind, page: p });
  }

  /** 檔案內容 · 經權限確認後由伺服器代理，R2 網址不外流（FMEA F-2） */
  @Get(":mediaId/content")
  @Roles(...VIEWERS)
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
}
