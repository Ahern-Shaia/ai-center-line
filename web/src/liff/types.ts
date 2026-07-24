// LIFF 已登入後的可信上下文（accessToken 由後端驗證取得可信 userId）
export interface LiffCtx {
  botId: string;
  lineUserId: string;
  displayName: string;
  pictureUrl: string | null;
  accessToken: string;
}

// window.liff（CDN SDK）· 只用到的幾個方法
export interface LiffSdk {
  closeWindow: () => void;
}
