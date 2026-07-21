import { SetMetadata } from "@nestjs/common";

export const REQUIRE_PERMISSION_KEY = "require_permission";

// 用法：@RequirePermission("line-bots:create")
// 或多條件（滿足任一即可）：@RequirePermission("line-bots:update", "line-bots:delete")
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
