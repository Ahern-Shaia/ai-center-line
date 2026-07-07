import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";

// notify 專用驗簽 guard：驗 X-Notify-Secret 對 NOTIFY_WEBHOOK_SECRET。
// 走 constant-time 比較，避免 timing attack；env 未設就 fail-fast 拒絕。
// 因為此 endpoint 標 @Public()（跳過 JwtAuthGuard），這是唯一的入口驗證。
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const rawHeader = req.headers["x-notify-secret"];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const expected = process.env.NOTIFY_WEBHOOK_SECRET;

    if (!expected || expected.length < 16) {
      // 設計文件 §7-bis.1：secret 未設 → endpoint 拒絕啟用（不是 500，是 401，避免 oracle）
      throw new UnauthorizedException("secret 未設或過短");
    }
    if (typeof provided !== "string" || provided.length === 0) {
      throw new UnauthorizedException("missing X-Notify-Secret");
    }

    const a = Buffer.from(provided, "utf-8");
    const b = Buffer.from(expected, "utf-8");
    // 長度先比：不同長度 timingSafeEqual 會 throw，所以先擋
    // 但為避免 length oracle，仍要吃掉 CPU 做假比較
    const dummy = Buffer.alloc(b.length, 0);
    if (a.length !== b.length) {
      timingSafeEqual(dummy, b); // dummy work
      throw new UnauthorizedException("invalid secret");
    }
    if (!timingSafeEqual(a, b)) {
      throw new UnauthorizedException("invalid secret");
    }
    return true;
  }
}
