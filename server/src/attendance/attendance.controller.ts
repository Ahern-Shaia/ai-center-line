import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { AttendanceService } from "./attendance.service.js";
import { AllowAnyUser } from "../auth/allow-any-user.decorator.js";
import { msg } from "../i18n/index.js";

// ⚠️ 從狀態機拿，不要在這裡另抄一份 —— 兩份清單遲早會漂移，
//    而漂移的症狀是「某個動作 400，但畫面上明明有那顆按鈕」。
import { PUNCH_TYPES, type PunchType } from "./trip-state.js";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 外勤打卡 · JWT 認證（LIFF 先 applyLiffToken 換 JWT）· 用 CurrentUser 的 user_id/tenant_id
// 見 docs/modules/attendance-location-mileage.md M1
@Controller("attendance")
export class AttendanceController {
  constructor(private readonly svc: AttendanceService) {}

  /** 現在該顯示哪顆按鈕 · 前端不要自己推（§7.1）*/
  @Get("state")
  @AllowAnyUser()
  async state(@CurrentUser() user: JwtUser) {
    return this.svc.getState(user);
  }

  @Post("punch")
  @AllowAnyUser()
  async punch(
    @CurrentUser() user: JwtUser,
    @Body() body: { punchType?: string; lat?: number; lng?: number; accuracyM?: number; customerName?: string },
  ) {
    if (!body?.punchType || !(PUNCH_TYPES as readonly string[]).includes(body.punchType)) {
      throw new BadRequestException(msg("srv.v.punchType"));
    }
    const lat = typeof body.lat === "number" ? body.lat : null;
    const lng = typeof body.lng === "number" ? body.lng : null;
    if ((lat === null) !== (lng === null)) throw new BadRequestException(msg("srv.v.latLngPair"));
    if (lat !== null && lng !== null && (lat < -90 || lat > 90 || lng < -180 || lng > 180)) {
      throw new BadRequestException(msg("srv.v.coordRange"));
    }
    return this.svc.punch(user, {
      punchType: body.punchType as PunchType,
      lat,
      lng,
      accuracyM: typeof body.accuracyM === "number" ? body.accuracyM : null,
      customerName: typeof body.customerName === "string" ? body.customerName.slice(0, 200) : null,
      source: "liff_geo",
    });
  }

  // 打卡備註（「這趟做了什麼」）· 員工只能改自己的 · punch-note-to-report M1
  @Patch("punch/:punchId/note")
  @AllowAnyUser()
  async annotate(
    @CurrentUser() user: JwtUser,
    @Param("punchId") punchId: string,
    @Body() body: { note?: string | null },
  ) {
    if (!UUID_RE.test(punchId)) throw new BadRequestException(msg("srv.v.punchId"));
    return this.svc.annotatePunch(user, punchId, typeof body?.note === "string" ? body.note : null);
  }

  // 補填/修正地點名稱（只改標籤，不動座標/時間/里程）· 員工只能改自己的
  @Patch("punch/:punchId/label")
  @AllowAnyUser()
  async relabel(
    @CurrentUser() user: JwtUser,
    @Param("punchId") punchId: string,
    @Body() body: { customerName?: string | null },
  ) {
    if (!UUID_RE.test(punchId)) throw new BadRequestException(msg("srv.v.punchId"));
    return this.svc.relabelPunch(user, punchId, typeof body?.customerName === "string" ? body.customerName : null);
  }

  /** 地點候選 · 自己去過的地方（選單是加速不是限制 · 前端仍保留自由輸入） */
  @Get("places")
  @AllowAnyUser()
  async places(@CurrentUser() user: JwtUser, @Query("q") q?: string) {
    return this.svc.placeSuggestions(user, typeof q === "string" ? q : null);
  }

  /** 本月外勤摘要 · 只回自己的（打卡完給同仁看自己的數字 · 4FR §7） */
  @Get("my-month")
  @AllowAnyUser()
  async myMonth(@CurrentUser() user: JwtUser) {
    return this.svc.myMonthSummary(user);
  }

  // date 選填（YYYY-MM-DD，台北日）· 省略＝當日 · 只回自己的行程 + 打卡序列
  @Get("trips")
  @AllowAnyUser()
  async trips(@CurrentUser() user: JwtUser, @Query("date") date?: string) {
    const d = typeof date === "string" && date ? date : null;
    return this.svc.tripsByDate(user, d);
  }

  // 地圖圖磚設定（前端 Leaflet 用）· tileApiKey 為 client-side key（osm 為 null）· 任何登入者可讀
  @Get("map-tile-config")
  @AllowAnyUser()
  async mapTileConfig() {
    return this.svc.tileConfig();
  }
}
