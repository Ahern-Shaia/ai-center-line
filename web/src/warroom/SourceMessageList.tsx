import MessageMedia from "../shared/MediaThumb";
import type { TicketSource } from "../api";
import { useT } from "../i18n/useT";

/**
 * 任務的來源原文。
 *
 * ⚠️ 這段有**兩個**呼叫點：任務卡裡的收合區（TaskBoard）與任務詳情抽屜（SourceDrawer）。
 * 原本各寫一份一模一樣的 markup —— 照片內嵌只加在其中一邊的話，
 * 客戶最常看的那個（卡片裡的收合區）就沒有圖，而且不會有任何錯誤。
 * 所以收成一份。
 */
export default function SourceMessageList({ data }: { data: TicketSource }) {
  const tr = useT();
  return (
    <>
      {data.messages.length > 0 && (
        <>
          <div className="ts-hd">{tr("sml.basedOn", { n: data.messages.length })}</div>
          {data.messages.map((m) => (
            <div key={m.id} className="ts-msg">
              <span className="ts-msg-meta">{m.time} {m.sender}</span>
              {/* 照片內嵌取代「[照片]」那三個字 ——
                  另外列一排的話，「這個可以嗎」指的是哪一張就看不出來 */}
              {m.media
                ? <MessageMedia mediaId={m.media.mediaId} kind={m.media.kind} />
                : <span className="ts-msg-text">{m.text}</span>}
            </div>
          ))}
        </>
      )}

      {/* ⚠️ 「沒有來源連結」≠「這幾則訊息沒有照片」。
          前者是我們不知道、後者是確定沒有 —— 都留白的話，主管無從判斷
          自己看到的是全部還是殘缺（prod 39 張任務裡 35 張是前者）。 */}
      {!data.hasSourceLink && (
        <div className="ts-no-link">
          {tr("sml.legacy")}
        </div>
      )}
    </>
  );
}
