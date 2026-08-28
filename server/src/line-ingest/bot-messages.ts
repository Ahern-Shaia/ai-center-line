/**
 * 1:1 私訊的 bot 回覆文案 · **中英雙語同一則**。
 *
 * ⚠️⚠️ 為什麼是「雙語同一則」而不是「依收件人語言擇一」？
 *
 *   i18n.md FMEA F-4 說推播的語言來源該是**收件人**的 `users.locale`，不是發起者的。
 *   那條在「系統主動推播給已知員工」時完全正確 —— 但這裡有一半訊息是
 *   **綁定之前**就要送出去的（加好友歡迎、未綁定提示），那時候
 *   **系統根本還不知道這個 LINE 帳號是誰**，`users.locale` 不存在。
 *
 *   所以這裡不做語言選擇，兩種語言一起送。附帶好處：不必查 DB、
 *   不會因為 locale 沒設就退回中文，而且外籍與本地員工看到的是同一則字。
 *
 * ⚠️ LINE 的硬限制（超過會整則送不出去，而且**我們這邊收不到錯誤**）：
 *   · buttons template `text`：**160 字**（無圖無標題時）
 *   · buttons `actions[].label`：**20 字** ← 最緊的一條，加英文最容易爆的就是它
 *   · `altText`：400 字　· 純文字訊息：5000 字
 *   `test/line-bot-msg.test.ts` 會逐條量，改文案時它會擋。
 *   來源：https://developers.line.biz/en/reference/messaging-api/
 */
export const BOT_MSG = {
  welcome:
    "歡迎加入！請點下方按鈕完成綁定 · 綁定後即可使用個人日報功能\n" +
    "Welcome! Tap the button below to link your account — then you can use daily reports.",
  notBound:
    "看起來還沒完成綁定 · 點下方按鈕即可（綁定後才能記錄日報）\n" +
    "You're not linked yet — tap below. Linking is required before we can log your reports.",
  bindFirst:
    "請先完成綁定才能記錄個人日報 · 聯繫公司資訊窗口\n" +
    "Please complete linking first · contact your company IT contact.",
  bindAlt: "完成綁定 / Link account",
  bindText: "點按鈕開始綁定\nTap to start linking",
  bindLabel: "開始綁定 / Link",

  pwAlt: "設定登入密碼 / Set password",
  pwText:
    "設密碼後 · 可用 email 登入 aiproot 網頁（選配 · 不設也可用「以 LINE 登入」）\n" +
    "Set a password to sign in on the web with email. Optional — LINE sign-in also works.",
  pwLabel: "設定密碼 / Set",

  reportAlt: "查看我的日報 / My Daily Report",
  reportText:
    "點按鈕看今日 AI 整理的日報 · 可編輯後送出主管\n" +
    "Tap to see today's AI-drafted report — edit it, then send it to your manager.",
  reportLabel: "我的日報 / My Report",

  ack: "✓ 已記錄 / Logged",

  /**
   * 當天第一則才附的提示。`at` 是各租戶自己設的批次時間
   * （**不可寫死** —— prod 上台灣福祉設的是 18:00）。
   * 拿不到時間就不講幾點，只說「會整理」—— **不要編一個時間出來**（R11）。
   */
  ackFirst: (at: string | null): string =>
    "✓ 已記錄 / Logged\n\n" +
    `傳「日報」可隨時查看今日記錄 · ${at ? `${at} 由 AI 整理成日報` : "AI 會整理成日報"}\n` +
    // ⚠️ 英文那句要講**英文使用者打得出來的字**。
    //    原本寫 Send「日報」—— 那是叫不會打中文的人去打中文。
    //    `report` 已加進 isDailyReportKeyword（line-webhook.service.ts）。
    `Send "report" any time to see today's log · ${at ? `AI drafts your report at ${at}` : "AI will draft your report"}`,
} as const;
