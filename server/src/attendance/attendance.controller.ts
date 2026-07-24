import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { AttendanceService } from "./attendance.service.js";

const PUNCH_TYPES = ["clock_in", "arrive_site", "clock_out"] as const;

// 外勤打卡 · JWT 認證（LIFF 先 applyLiffToken 換 JWT）· 用 CurrentUser 的 user_id/tenant_id
// 見 docs/modules/attendance-location-mileage.md M1
@Controller("attendance")
export class AttendanceController {
  constructor(private readonly svc: AttendanceService) {}

  @Post("punch")
  async punch(
    @CurrentUser() user: JwtUser,
    @Body() body: { punchType?: string; lat?: number; lng?: number; accuracyM?: number; customerName?: string },
  ) {
    if (!body?.punchType || !(PUNCH_TYPES as readonly string[]).includes(body.punchType)) {
      throw new BadRequestException("punchType 必要 · 需為 clock_in | arrive_site | clock_out");
    }
    const lat = typeof body.lat === "number" ? body.lat : null;
    const lng = typeof body.lng === "number" ? body.lng : null;
    if ((lat === null) !== (lng === null)) throw new BadRequestException("lat/lng 需成對提供");
    if (lat !== null && lng !== null && (lat < -90 || lat > 90 || lng < -180 || lng > 180)) {
      throw new BadRequestException("座標超出合理範圍");
    }
    return this.svc.punch(user, {
      punchType: body.punchType as (typeof PUNCH_TYPES)[number],
      lat,
      lng,
      accuracyM: typeof body.accuracyM === "number" ? body.accuracyM : null,
      customerName: typeof body.customerName === "string" ? body.customerName.slice(0, 200) : null,
      source: "liff_geo",
    });
  }

  @Get("trips/today")
  async todayTrips(@CurrentUser() user: JwtUser) {
    return { trips: await this.svc.todayTrips(user) };
  }
}
