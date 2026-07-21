import type { LineBotDto } from "../api";
import { formatRelative } from "./utils";

// 左 pane · Bot 列表
export function BotList({
  bots, selectedId, onSelect, loading, canManage,
}: {
  bots: LineBotDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  canManage: boolean;
}) {
  return (
    <aside className="lbot-list">
      <div className="lbot-list-hdr">
        機器人 <span className="lbot-list-count">{bots.length}</span>
      </div>
      {loading ? (
        <div className="lbot-list-empty">載入中…</div>
      ) : bots.length === 0 ? (
        <div className="lbot-list-empty">
          尚無機器人
          {canManage && <div className="lbot-list-empty-hint">點右上「新增機器人」建立</div>}
        </div>
      ) : (
        <ul className="lbot-list-ul">
          {bots.map((b) => {
            const active = b.status === "active";
            const verified = b.webhookVerifiedAt != null;
            const dot = !active ? "off" : verified ? "on" : "pending";
            return (
              <li key={b.botId}>
                <button
                  className={`lbot-list-item${selectedId === b.botId ? " selected" : ""}`}
                  onClick={() => onSelect(b.botId)}
                >
                  <span className={`lbot-dot lbot-dot--${dot}`} aria-hidden />
                  <span className="lbot-list-body">
                    <span className="lbot-list-name">{b.name}</span>
                    <span className="lbot-list-sub">
                      {b.groupCount} 群 · {formatRelative(b.updatedAt)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

// 右 pane · Empty state（未選中 bot）
export function BotDetailEmpty({ canManage, onNew }: { canManage: boolean; onNew: () => void }) {
  return (
    <section className="lbot-detail lbot-detail-empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <circle cx="9" cy="12" r="1" fill="currentColor" />
        <circle cx="15" cy="12" r="1" fill="currentColor" />
        <path d="M8 18l-1 3 4-3" />
      </svg>
      <div className="lbot-detail-empty-title">選擇左側機器人查看詳情</div>
      {canManage && (
        <button className="btn" onClick={onNew}>或新增機器人</button>
      )}
    </section>
  );
}
