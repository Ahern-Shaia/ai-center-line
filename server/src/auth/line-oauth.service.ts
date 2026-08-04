import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { sql } from "drizzle-orm";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { withTenant } from "../db/client.js";
import { EmployeeBindingService } from "../employee-binding/employee-binding.service.js";
import { verifyLiffAccessToken } from "./liff-verify.js";
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
const STATE_TTL_MS = 10 * 60 * 1000;   // OAuth state 有效期 10 分鐘

@Injectable()
export class LineOauthService {
  private readonly logger = new Logger(LineOauthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly bindingService: EmployeeBindingService,
  ) {}

  // ===== OAuth state（防 CSRF）· 無狀態簽章 =====
  // 為何不靠前端 sessionStorage：手機上 LINE 內建瀏覽器常把 OAuth 導回交給系統瀏覽器（Safari），
  // 兩者儲存空間不同 → state 讀不到、被誤判「state 不符」而完全登不進去。
  // 改用 HMAC 簽章 + 有效期由後端驗：不依賴瀏覽器儲存，也不怕服務重啟／休眠。
  private stateSecret(): string {
    return process.env.JWT_SECRET ?? "dev-only-change-me";
  }

  private signState(): string {
    const payload = `${randomBytes(8).toString("hex")}.${Date.now() + STATE_TTL_MS}`;
    const sig = createHmac("sha256", this.stateSecret()).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  /** 驗證 state 簽章與效期（格式錯／簽章錯／過期 → false）*/
  verifyState(state: string | undefined): boolean {
    if (!state) return false;
    const parts = state.split(".");
    if (parts.length !== 3) return false;
    const [nonce, expStr, sig] = parts;
    const expected = createHmac("sha256", this.stateSecret()).update(`${nonce}.${expStr}`).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    const exp = Number(expStr);
    return Number.isFinite(exp) && exp > Date.now();
  }

  /**
   * 產 OAuth URL · 前端拿去 redirect
   * · state 為簽章 token · callback 時由後端 verifyState
   */
  buildAuthUrl(state?: string): { url: string; state: string } {
    const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
    const callbackUrl = process.env.LINE_LOGIN_CALLBACK_URL;
    if (!clientId || !callbackUrl) {
      throw new Error("LINE_LOGIN_CHANNEL_ID / CALLBACK_URL env 未設");
    }
    const stateValue = state ?? this.signState();
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
  async handleCallback(code: string): Promise<LineLoginResult | TenantChoiceResult> {
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

    // Step 3 · lineUserId → binding → JWT 或（一人多租戶時）回選單
    // 網頁「以 LINE 登入」沒有 bot 上下文，多綁時無法確定要哪個租戶 → 讓使用者選（B）。
    return this.resolveOrChoose(profile.userId);
  }

  /**
   * LIFF access token → 驗證（channel + 效期）→ 可信 userId → JWT
   * · 安全：不信任前端送來的 lineUserId · 走 LINE verify + profile 取可信身分
   *   （對照 https://developers.line.biz/en/docs/liff/using-user-profile/）
   * · 前提：LIFF app 掛在 LINE_LOGIN_CHANNEL_ID 這支 LINE Login channel 下（verify 的 client_id 才會相符）
   */
  // LIFF 是從**特定租戶的 bot** 開的（URL 帶 botId）· 用 botId 綁死租戶（A）——
  // 一人綁多個租戶時，才不會像舊版那樣拿「最近綁定」的別家帳號（2026-08-03 實際踩到：
  // Patrick 的 LINE 綁台灣福祉在先、綁鮮湧在後 → 從台灣福祉 bot 開卻登入成鮮湧林乙坤）。
  async handleLiffToken(accessToken: string, botId?: string): Promise<LineLoginResult> {
    // 0060 · 有 botId 就用該 bot 自己的 login_channel_id 驗 token，擋掉跨 provider 的憑證
    const expectedChannelId = botId ? await this.loginChannelIdOf(botId) : null;
    const lineUserId = await verifyLiffAccessToken(accessToken, expectedChannelId);
    const bindings = await this.resolveBindings(lineUserId);
    if (bindings.length === 0) {
      throw new UnauthorizedException("此 LINE 帳號尚未綁定 aiproot · 請先加 bot 好友完成綁定");
    }
    if (botId) {
      const match = bindings.find((b) => b.bot_id === botId);
      if (!match) throw new UnauthorizedException("此 LINE 帳號未綁定到這個組織 · 請用正確組織的 bot 開啟");
      return this.signJwtForBinding(match);
    }
    // 沒帶 botId：只有一筆綁定時沒有歧義，照發。
    if (bindings.length === 1) return this.signJwtForBinding(bindings[0]);

    // 多筆就**不能猜**。舊版這裡退回「最新綁定」，2026-08-04 出事：
    // rich menu 的 URL（見 docs/sop/richmenu-attendance-setup.md）沒帶 botId，
    // 於是 Patrick 從 aiproot 的選單開「我的日報」，卻被當成鮮湧的林乙坤，
    // 按下「重新生成」把日報寫進了別家公司 —— 全程沒有任何提示。
    // 靜默猜錯比報錯危險得多：使用者不會發現，資料已經進了錯的租戶。
    throw new UnauthorizedException(
      "這個 LINE 帳號綁定了多個組織，無法判斷要開哪一個 · 請從該組織機器人的選單重新開啟",
    );
  }

  /** 一人多租戶時讓網頁使用者選組織後發 JWT（B）· selectionToken 內含已驗證的 lineUserId、防偽造 */
  async selectTenant(selectionToken: string, tenantId: string): Promise<LineLoginResult> {
    let payload: { purpose?: string; line_user_id?: string };
    try {
      payload = await this.jwt.verifyAsync(selectionToken);
    } catch {
      throw new UnauthorizedException("選擇連結已失效 · 請重新以 LINE 登入");
    }
    if (payload.purpose !== "tenant-select" || !payload.line_user_id) {
      throw new UnauthorizedException("無效的組織選擇 token");
    }
    const bindings = await this.resolveBindings(payload.line_user_id);
    const match = bindings.find((b) => b.tenant_id === tenantId);
    if (!match) throw new UnauthorizedException("你在該組織沒有帳號");
    return this.signJwtForBinding(match);
  }

  /** 0060 · 查該 bot 綁定的 LINE Login channel · 未設回 null（退回 env 允許清單） */
  private async loginChannelIdOf(botId: string): Promise<string | null> {
    const res = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => tx.execute<{
      login_channel_id: string | null;
    }>(sql`SELECT login_channel_id FROM line_bot WHERE bot_id = ${botId} LIMIT 1`));
    return res.rows[0]?.login_channel_id ?? null;
  }

  /** 該 lineUserId 的所有 active 綁定（跨租戶）· aiproot 上下文讀 · 新到舊 */
  private async resolveBindings(lineUserId: string) {
    const res = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => tx.execute<{
      user_id: string; role: string; tenant_id: string | null; department_id: string | null;
      tenant_name: string | null; bot_id: string;
    }>(sql`
      SELECT b.user_id::text, u.role, u.tenant_id::text, u.department_id::text,
             t.tenant_name, b.bot_id::text
      FROM user_line_binding b
      JOIN users u ON u.user_id = b.user_id
      LEFT JOIN tenants t ON t.tenant_id = u.tenant_id
      WHERE b.line_user_id = ${lineUserId}
        AND b.status = 'active'
      ORDER BY b.bound_at DESC
    `));
    return res.rows;
  }

  /** 綁定 0 → 擋；1 → 直接發 JWT；多筆 → 回選單（需使用者選組織）*/
  private async resolveOrChoose(lineUserId: string): Promise<LineLoginResult | TenantChoiceResult> {
    const bindings = await this.resolveBindings(lineUserId);
    if (bindings.length === 0) {
      throw new UnauthorizedException("此 LINE 帳號尚未綁定 aiproot · 請先加 bot 好友完成綁定");
    }
    if (bindings.length === 1) {
      return this.signJwtForBinding(bindings[0]);
    }
    const selectionToken = await this.jwt.signAsync(
      { purpose: "tenant-select", line_user_id: lineUserId },
      { expiresIn: "5m" },
    );
    this.logger.log(`LINE 多租戶綁定 · 需選組織 · lineUserId=…${lineUserId.slice(-6)} · ${bindings.length} 個`);
    return {
      needsTenantChoice: true,
      selectionToken,
      options: bindings.map((b) => ({ tenantId: b.tenant_id, tenantName: b.tenant_name, role: b.role })),
    };
  }

  private async signJwtForBinding(b: {
    user_id: string; role: string; tenant_id: string | null; department_id: string | null;
  }): Promise<LineLoginResult> {
    const payload: JwtUser = {
      user_id: b.user_id,
      role: b.role as JwtUser["role"],
      tenant_id: b.tenant_id,
      department_id: b.department_id,
    };
    const token = await this.jwt.signAsync(payload);
    this.logger.log(`LINE JWT issued · userId=${b.user_id.slice(-6)} · role=${b.role} · tenant=${b.tenant_id?.slice(0, 8) ?? "—"}`);
    return { access_token: token, role: b.role, tenant_id: b.tenant_id };
  }
}

export interface LineLoginResult { access_token: string; role: string; tenant_id: string | null }
export interface TenantChoiceResult {
  needsTenantChoice: true;
  selectionToken: string;
  options: Array<{ tenantId: string | null; tenantName: string | null; role: string }>;
}
