// 每一頁的用途說明 · 集中一份
//
// 起於用戶回報「側欄的每個功能頁面我都要說明用途」——
// 這份文案是拿來**取代口頭講解**的，所以寫法跟一般說明不同：
//
//   · 「回答什麼問題」用**使用者的話**問，不是功能名（「今天有哪些事要我確認」不是「任務管理」）
//   · 「資料從哪來」一定要講到**沒有人需要另外填表** —— 那是這個產品最反直覺、也最常被問的一點
//   · 「你通常會做什麼」給**具體時間**（「每天約 3 分鐘」），比形容詞有用
//   · 「誰看得到」是講給別人聽時最常被追問的，而畫面上原本完全沒有
//
// ⚠️ 集中在這一支：文案會一直改，散在 6 個頁面裡等於下次要改 6 個地方。

// ⚠️ 2026-08-27 i18n：四個欄位存的是 **key**，文字在 i18n/*.ts（`guide.<page>.<field>`）
export interface PageGuide {
  q: string;      // 回答什麼問題
  from: string;   // 資料從哪來
  todo: string;   // 你通常會做什麼
  who: string;    // 誰看得到
}

export const PAGE_GUIDES: Record<string, PageGuide> = {
  "task-board": {
    q: "guide.task-board.q",
    from: "guide.task-board.from",
    todo: "guide.task-board.todo",
    who: "guide.task-board.who",
  },
  warroom: {
    q: "guide.warroom.q",
    from: "guide.warroom.from",
    todo: "guide.warroom.todo",
    who: "guide.warroom.who",
  },
  "daily-log": {
    q: "guide.daily-log.q",
    from: "guide.daily-log.from",
    todo: "guide.daily-log.todo",
    who: "guide.daily-log.who",
  },
  depts: {
    q: "guide.depts.q",
    from: "guide.depts.from",
    todo: "guide.depts.todo",
    who: "guide.depts.who",
  },
  channels: {
    q: "guide.channels.q",
    from: "guide.channels.from",
    todo: "guide.channels.todo",
    who: "guide.channels.who",
  },
  "scheduler-config": {
    q: "guide.scheduler-config.q",
    from: "guide.scheduler-config.from",
    todo: "guide.scheduler-config.todo",
    who: "guide.scheduler-config.who",
  },
};
