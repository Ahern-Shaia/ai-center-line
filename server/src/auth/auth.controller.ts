import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { AuthService, type LoginResult } from "./auth.service.js";
import { CurrentUser } from "./current-user.decorator.js";
import type { JwtUser } from "./jwt-user.js";
import { LineOauthService } from "./line-oauth.service.js";
import { Public } from "./public.decorator.js";
import { ChangePasswordSchema } from "./dto/change-password.dto.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly lineOauth: LineOauthService,
  ) {}

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

  // LINE Login OAuth · 前端拿 auth URL
  @Public()
  @Get("line/oauth-url")
  async lineOauthUrl() {
    return this.lineOauth.buildAuthUrl();
  }

  // LINE Login OAuth · callback · 前端把 code 傳來 · backend 換 JWT
  @Public()
  @Post("line/callback")
  async lineOauthCallback(@Body() body: { code?: string }) {
    if (!body?.code) throw new BadRequestException("缺 code");
    return this.lineOauth.handleCallback(body.code);
  }
}
