import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { withTenant } from "../db/client.js";
import { EmployeeBindingService } from "../employee-binding/employee-binding.service.js";
import type { JwtUser } from "./jwt-user.js";

/**
 * LineOauthService · LINE Login OAuth 2.0
 * 對照 https://developers.line.biz/en/docs/line-login/integrate-line-login/
 *
 * Flow:
 *   1. 前端點「以 LINE 登入」 → 打 /auth/line/oauth-url · 拿 auth URL
 *   2. 導向 LINE OAuth · 使用者授權
 *   3. LINE redirect 回 callback URL 帶 code
 *   4. 前端把 code POST /auth/line/callback
 *   5. Backend 用 code 換 token · 用 token 拿 userId
 *   6. 對照 user_line_binding · 找對應 aiproot user · 發 JWT
 *
 * 需 env:
 *   LINE_LOGIN_CHANNEL_ID (公開 · 從 LINE Login channel Basic settings)
 *   LINE_LOGIN_CHANNEL_SECRET (機密 · 同上)
 *   LINE_LOGIN_CALLBACK_URL (前端 · e.g. https://ai-center-line-demo.onrender.com/auth/line/callback)
 */
@Injectable()
export class LineOauthService {
  private readonly logger = new Logger(LineOauthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly bindingService: EmployeeBindingService,
  ) {}

  /**
   * 產 OAuth URL · 前端拿去 redirect
   * · state 用來防 CSRF · 前端記憶 · callback 時 verify
   */
  buildAuthUrl(state?: string): { url: string; state: string } {
    const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
    const callbackUrl = process.env.LINE_LOGIN_CALLBACK_URL;
    if (!clientId || !callbackUrl) {
      throw new Error("LINE_LOGIN_CHANNEL_ID / CALLBACK_URL env 未設");
    }
    const stateValue = state ?? randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: callbackUrl,
      state: stateValue,
      scope: "profile openid",
      bot_prompt: "normal",   // 若還沒加 bot 好友 · 提示加
    });
    return {
      url: `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`,
      state: stateValue,
    };
  }

  /**
   * Callback · code → token → userId → user_line_binding → JWT
   * · 若查不到 binding · 提示「請先綁定」
   * · 多 tenant · 若某 lineUserId 綁多個 bot（罕見）· 用第一個 active
   */
  async handleCallback(code: string): Promise<{ access_token: string; role: string; tenant_id: string | null }> {
    const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
    const clientSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
    const callbackUrl = process.env.LINE_LOGIN_CALLBACK_URL;
    if (!clientId || !clientSecret || !callbackUrl) {
      throw new Error("LINE Login env 未齊 · 需 CHANNEL_ID / CHANNEL_SECRET / CALLBACK_URL");
    }

    // Step 1 · code → token
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUrl,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => "");
      this.logger.warn(`LINE token exchange failed · ${tokenRes.status} · ${body.slice(0, 200)}`);
      throw new UnauthorizedException("LINE 授權失敗 · 請重試");
    }
    const tokenData = await tokenRes.json() as { access_token?: string; id_token?: string };
    if (!tokenData.access_token) throw new UnauthorizedException("LINE 未回 access_token");

    // Step 2 · access_token → profile (拿 userId)
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!profileRes.ok) {
      throw new UnauthorizedException("拿不到 LINE profile");
    }
    const profile = await profileRes.json() as { userId?: string; displayName?: string };
    if (!profile.userId) throw new UnauthorizedException("LINE profile 無 userId");

    // Step 3 · lineUserId → binding → JWT（與 LIFF token 路徑共用）
    return this.issueJwtForLineUserId(profile.userId);
  }

  /**
   * LIFF access token → 驗證（channel + 效期）→ 可信 userId → JWT
   * · 安全：不信任前端送來的 lineUserId · 走 LINE verify + profile 取可信身分
   *   （對照 https://developers.line.biz/en/docs/liff/using-user-profile/）
   * · 前提：LIFF app 掛在 LINE_LOGIN_CHANNEL_ID 這支 LINE Login channel 下（verify 的 client_id 才會相符）
   */
  async handleLiffToken(accessToken: string): Promise<{ access_token: string; role: string; tenant_id: string | null }> {
    const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
    if (!channelId) throw new Error("LINE_LOGIN_CHANNEL_ID env 未設");

    // Step 1 · verify access token（確認是發給我們 channel 的、且未過期）
    const verifyRes = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`);
    if (!verifyRes.ok) {
      const body = await verifyRes.text().catch(() => "");
      this.logger.warn(`LIFF token verify failed · ${verifyRes.status} · ${body.slice(0, 200)}`);
      throw new UnauthorizedException("LIFF 登入憑證無效 · 請重開頁面");
    }
    const verify = await verifyRes.json() as { client_id?: string; expires_in?: number };
    if (verify.client_id !== channelId) throw new UnauthorizedException("LIFF 憑證 channel 不符");
    if (!verify.expires_in || verify.expires_in <= 0) throw new UnauthorizedException("LIFF 登入憑證已過期 · 請重開頁面");

    // Step 2 · access token → profile（拿可信 userId）
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) throw new UnauthorizedException("拿不到 LINE profile");
    const profile = await profileRes.json() as { userId?: string };
    if (!profile.userId) throw new UnauthorizedException("LINE profile 無 userId");

    return this.issueJwtForLineUserId(profile.userId);
  }

  /**
   * lineUserId → user_line_binding → JWT（OAuth callback 與 LIFF token 共用）
   * · 走 aiproot_admin 上下文跨租戶讀；多 bot 取最新 active
   */
  private async issueJwtForLineUserId(lineUserId: string): Promise<{ access_token: string; role: string; tenant_id: string | null }> {
    const bindings = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => tx.execute<{
      user_id: string; role: string; tenant_id: string | null; department_id: string | null;
    }>(sql`
      SELECT b.user_id::text, u.role, u.tenant_id::text, u.department_id::text
      FROM user_line_binding b
      JOIN users u ON u.user_id = b.user_id
      WHERE b.line_user_id = ${lineUserId}
        AND b.status = 'active'
      ORDER BY b.bound_at DESC
      LIMIT 1
    `));

    const binding = bindings.rows[0];
    if (!binding) {
      throw new UnauthorizedException("此 LINE 帳號尚未綁定 aiproot · 請先加 bot 好友完成綁定");
    }

    const payload: JwtUser = {
      user_id: binding.user_id,
      role: binding.role as JwtUser["role"],
      tenant_id: binding.tenant_id,
      department_id: binding.department_id,
    };
    const token = await this.jwt.signAsync(payload);
    this.logger.log(`LINE JWT issued · userId=${binding.user_id.slice(-6)} · role=${binding.role}`);
    return { access_token: token, role: binding.role, tenant_id: binding.tenant_id };
  }
}
