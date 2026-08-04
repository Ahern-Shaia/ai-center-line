import { Logger, UnauthorizedException } from "@nestjs/common";

const logger = new Logger("LiffVerify");

// LIFF access token → 驗證（channel 允許清單 + 效期）→ /v2/profile → 可信 lineUserId
// 無 DI 工具函式：line-oauth（換 JWT）與 employee-binding（綁定端點）共用，避免循環相依。
// 不信任前端送來的 lineUserId —— 一律以此取得可信身分（修 IDOR）。
//
// 0060 · expectedChannelId（該 bot 的 login_channel_id）：
//   有帶就**只認這一支** Login channel，不吃全域允許清單。
//   理由見 docs/modules/liff-multi-provider.md —— LINE 的 userId 依 provider 發放，
//   拿 A provider 的 LIFF token 去綁 B provider 的 bot，會寫進一個永遠對不上 webhook 的
//   line_user_id，而且整個流程「看起來成功」。與其事後查資料，不如在這裡就擋下來。
export async function verifyLiffAccessToken(accessToken: string, expectedChannelId?: string | null): Promise<string> {
  const allowed = expectedChannelId
    ? new Set([expectedChannelId])
    : new Set(
      [process.env.LINE_LOGIN_CHANNEL_ID, ...(process.env.LIFF_CHANNEL_IDS?.split(",") ?? [])]
        .map((s) => s?.trim())
        .filter((s): s is string => !!s),
    );
  if (allowed.size === 0) throw new Error("LINE_LOGIN_CHANNEL_ID / LIFF_CHANNEL_IDS 未設");

  const verifyRes = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`);
  if (!verifyRes.ok) {
    const body = await verifyRes.text().catch(() => "");
    logger.warn(`LIFF token verify failed · ${verifyRes.status} · ${body.slice(0, 200)}`);
    throw new UnauthorizedException("LIFF 登入憑證無效 · 請重開頁面");
  }
  const verify = await verifyRes.json() as { client_id?: string; expires_in?: number };
  if (!verify.client_id || !allowed.has(verify.client_id)) {
    // 印出實際收到什麼 vs 預期什麼 —— 不猜原因（這兩個值就足以判斷是設定錯還是開錯 LIFF）
    logger.warn(
      `LIFF token channel 不符 · 實收 client_id=${verify.client_id ?? "(無)"} · `
      + `允許=${[...allowed].join(",")}${expectedChannelId ? " (依 bot 的 login_channel_id)" : " (依 env 允許清單)"}`,
    );
    throw new UnauthorizedException("這個綁定連結不是這個組織的 · 請從該組織的 LINE bot 重新開啟");
  }
  if (!verify.expires_in || verify.expires_in <= 0) throw new UnauthorizedException("LIFF 登入憑證已過期 · 請重開頁面");

  const profileRes = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileRes.ok) throw new UnauthorizedException("拿不到 LINE profile");
  const profile = await profileRes.json() as { userId?: string };
  if (!profile.userId) throw new UnauthorizedException("LINE profile 無 userId");
  return profile.userId;
}
