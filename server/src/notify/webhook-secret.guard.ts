import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { TenantRegistry, type TenantConfig } from "./tenant.registry.js";

// notify 專用驗簽 guard：驗 X-Notify-Secret 對 tenant registry 內任一 tenant 的 secret。
// 命中 → req.tenant = matched；未命中 → 401。
// Timing 安全性：掃完所有 tenant 才回應（不 early return），避免藉回應時間推測 tenant 數量。

export interface NotifyRequest {
  headers: Record<string, string | string[] | undefined>;
  tenant?: TenantConfig;
}

@Injectable()
export class WebhookSecretGuard implements CanActivate {
  constructor(private readonly tenants: TenantRegistry) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<NotifyRequest>();
    const rawHeader = req.headers["x-notify-secret"];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (typeof provided !== "string" || provided.length === 0) {
      throw new UnauthorizedException("missing X-Notify-Secret");
    }

    const providedBuf = Buffer.from(provided, "utf-8");
    let matched: TenantConfig | null = null;

    for (const t of this.tenants.all()) {
      const expectedBuf = Buffer.from(t.webhookSecret, "utf-8");
      // 長度不同 timingSafeEqual 會 throw；仍做 dummy 比較消耗 CPU 避免 length oracle
      if (providedBuf.length !== expectedBuf.length) {
        const dummy = Buffer.alloc(expectedBuf.length, 0);
        timingSafeEqual(dummy, expectedBuf);
        continue;
      }
      if (timingSafeEqual(providedBuf, expectedBuf)) {
        matched = t;
        // 不 break — 掃完所有 tenant 讓回應時間不洩漏「命中在第幾個」
      }
    }

    if (!matched) {
      throw new UnauthorizedException("invalid secret");
    }

    req.tenant = matched;
    return true;
  }
}
