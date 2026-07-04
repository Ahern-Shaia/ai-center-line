import { SetMetadata } from "@nestjs/common";

// 標記路由為公開（跳過 JwtAuthGuard）。例：/auth/login、/health。
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
