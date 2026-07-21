import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { AuthService, type LoginResult } from "./auth.service.js";
import { CurrentUser } from "./current-user.decorator.js";
import type { JwtUser } from "./jwt-user.js";
import { Public } from "./public.decorator.js";
import { ChangePasswordSchema } from "./dto/change-password.dto.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  async login(@Body() body: { email?: string; password?: string }): Promise<LoginResult> {
    if (!body?.email || !body?.password) {
      throw new BadRequestException("需要 email 與 password");
    }
    return this.auth.login(body.email, body.password);
  }

  // 自服務改密碼 · 任何登入使用者皆可（改自己的）
  @Post("change-password")
  async changePassword(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const parsed = ChangePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    await this.auth.changePassword(user.user_id, parsed.data.oldPassword, parsed.data.newPassword);
    return { status: "ok" };
  }
}
