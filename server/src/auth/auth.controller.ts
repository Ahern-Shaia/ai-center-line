import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { AuthService, type LoginResult } from "./auth.service.js";
import { CurrentUser } from "./current-user.decorator.js";
import type { JwtUser } from "./jwt-user.js";
import { LineOauthService } from "./line-oauth.service.js";
import { Public } from "./public.decorator.js";
import { ChangePasswordSchema } from "./dto/change-password.dto.js";
import { DisplayNameSchema } from "./dto/display-name.dto.js";
import { LocaleSchema } from "./dto/locale.dto.js";
import { AllowAnyUser } from "../auth/allow-any-user.decorator.js";

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
  @AllowAnyUser()
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

  // 自服務改顯示名稱 · 任何登入使用者皆可（只改自己的）· LINE 用戶把佔位名改成真名
  @Post("display-name")
  @AllowAnyUser()
  async changeDisplayName(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const parsed = DisplayNameSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const displayName = await this.auth.changeDisplayName(user.user_id, parsed.data.displayName);
    return { displayName };
  }

  // 自服務改介面語言 · 任何登入使用者皆可（只改自己的）
  @Post("locale")
  @AllowAnyUser()
  async changeLocale(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const parsed = LocaleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const locale = await this.auth.changeLocale(user.user_id, parsed.data.locale);
    return { locale };
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
  async lineOauthCallback(@Body() body: { code?: string; state?: string }) {
    if (!body?.code) throw new BadRequestException("缺 code");
    // CSRF 防護改由後端驗簽章 state · 前端 sessionStorage 在 LINE→系統瀏覽器交接時會遺失
    if (!this.lineOauth.verifyState(body.state)) {
      throw new BadRequestException("登入連結已失效 · 請重新點「以 LINE 登入」");
    }
    return this.lineOauth.handleCallback(body.code);
  }

  // LIFF · 前端送 access token（liff.getAccessToken）· backend 驗證 channel+效期+profile 後換 JWT
  // 取代舊「信任前端 lineUserId」的 @Public LIFF 端點（修 IDOR）· 見 docs/modules/liff-webapp-consolidation.md
  // botId：LIFF 從特定租戶的 bot 開 → 用它綁死租戶（一人多租戶時才不會拿錯家 · 見 line-oauth A）
  @Public()
  @Post("liff/token")
  async liffToken(@Body() body: { accessToken?: string; botId?: string }) {
    if (!body?.accessToken) throw new BadRequestException("缺 accessToken");
    return this.lineOauth.handleLiffToken(body.accessToken, body.botId);
  }

  // 一人多租戶 · 網頁登入選了組織後換該租戶的 JWT（B）· selectionToken 內含已驗證 lineUserId
  @Public()
  @Post("line/select-tenant")
  async lineSelectTenant(@Body() body: { selectionToken?: string; tenantId?: string }) {
    if (!body?.selectionToken || !body?.tenantId) throw new BadRequestException("缺 selectionToken 或 tenantId");
    return this.lineOauth.selectTenant(body.selectionToken, body.tenantId);
  }
}
