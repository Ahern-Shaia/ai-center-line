import { useState } from "react";
import {
  createLineBot,
  updateLineBot,
  ApiError,
  type LineBotDto,
  type LineRefsDto,
} from "./api";
import { useToast } from "./Toast";
import Drawer from "./Drawer";

// 新增 Bot Drawer (aiproot_admin only)
export function NewBotDrawer({
  refs, onClose, onCreated,
}: {
  refs: LineRefsDto;
  onClose: () => void;
  onCreated: (bot: LineBotDto) => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [tenantId, setTenantId] = useState(refs.tenants[0]?.tenantId ?? "");
  const [channelId, setChannelId] = useState("");
  const [channelSecret, setChannelSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !tenantId || !channelSecret.trim() || !accessToken.trim()) {
      toast.show("請填齊必要欄位", "danger");
      return;
    }
    setSaving(true);
    try {
      const res = await createLineBot({
        name: name.trim(),
        tenantId,
        channelId: channelId.trim() || undefined,
        channelSecret: channelSecret.trim(),
        channelAccessToken: accessToken.trim(),
      });
      toast.show("機器人已新增 · 已驗證 Access Token", "ok");
      onCreated(res.bot);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "新增失敗", "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="新增 LINE 機器人"
      subtitle="從 LINE Developers Console 拿 Channel Secret 與 Access Token"
    >
      <form onSubmit={handleSubmit} className="llm-form">
        <div className="field">
          <label>機器人名稱 *</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} placeholder="例：台灣福祉 AI 客服" required />
          <div className="llm-hint">此名稱僅顯示於後台 · 與 LINE 官方帳號顯示名可不同</div>
        </div>

        <div className="field">
          <label>隸屬租戶 *</label>
          <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} disabled={saving} required>
            {refs.tenants.length === 0 && <option value="">尚無租戶</option>}
            {refs.tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenantName}</option>)}
          </select>
        </div>

        <div className="field">
          <label>Channel ID（選填）</label>
          <input type="text" value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={saving} placeholder="例：1234567890" />
          <div className="llm-hint">Basic settings 頁最上方 · 純顯示用</div>
        </div>

        <div className="field">
          <label>Channel Secret *</label>
          <input type="password" value={channelSecret} onChange={(e) => setChannelSecret(e.target.value)} disabled={saving} placeholder="從 LINE Console Basic settings 拿" required autoComplete="new-password" />
          <div className="llm-hint">AES-256 加密存 Postgres · 用於 webhook 驗簽</div>
        </div>

        <div className="field">
          <label>Channel Access Token *</label>
          <input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} disabled={saving} placeholder="從 Messaging API 頁 Issue / 顯示" required autoComplete="new-password" />
          <div className="llm-hint">會即刻呼叫 LINE API 驗證真實有效 · 失敗會提示</div>
        </div>

        <div className="llm-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "新增中…" : "新增機器人"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>取消</button>
        </div>
      </form>
    </Drawer>
  );
}

// 編輯 Bot Drawer (aiproot_admin only)
export function EditBotDrawer({
  bot, onClose, onSaved,
}: {
  bot: LineBotDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(bot.name);
  const [channelId, setChannelId] = useState(bot.channelId ?? "");
  const [rotateSecret, setRotateSecret] = useState(false);
  const [rotateToken, setRotateToken] = useState(false);
  const [newSecret, setNewSecret] = useState("");
  const [newToken, setNewToken] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const patch: Parameters<typeof updateLineBot>[1] = {
        name: name.trim() !== bot.name ? name.trim() : undefined,
        channelId: channelId !== (bot.channelId ?? "") ? (channelId.trim() || null) : undefined,
      };
      if (rotateSecret && newSecret.trim()) patch.channelSecret = newSecret.trim();
      if (rotateToken && newToken.trim()) patch.channelAccessToken = newToken.trim();

      await updateLineBot(bot.botId, patch);
      toast.show("機器人已更新", "ok");
      onSaved();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "更新失敗", "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title="編輯機器人" subtitle={bot.name}>
      <form onSubmit={handleSubmit} className="llm-form">
        <div className="field">
          <label>機器人名稱</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
        </div>

        <div className="field">
          <label>Channel ID（選填）</label>
          <input type="text" value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={saving} placeholder="例：1234567890" />
        </div>

        <div className="lbot-rotate">
          <label className="lbot-rotate-hdr">
            <input type="checkbox" checked={rotateSecret} onChange={(e) => setRotateSecret(e.target.checked)} disabled={saving} />
            <span>更新 Channel Secret</span>
          </label>
          {rotateSecret && (
            <input
              type="password"
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              disabled={saving}
              placeholder="新 Channel Secret"
              required
              autoComplete="new-password"
              className="lbot-rotate-input"
            />
          )}
        </div>

        <div className="lbot-rotate">
          <label className="lbot-rotate-hdr">
            <input type="checkbox" checked={rotateToken} onChange={(e) => setRotateToken(e.target.checked)} disabled={saving} />
            <span>更新 Access Token</span>
          </label>
          {rotateToken && (
            <input
              type="password"
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              disabled={saving}
              placeholder="新 Access Token"
              required
              autoComplete="new-password"
              className="lbot-rotate-input"
            />
          )}
        </div>

        <div className="llm-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "儲存中…" : "儲存變更"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>取消</button>
        </div>
      </form>
    </Drawer>
  );
}

// 停用確認 Modal
export function DisableConfirmModal({
  botName, onCancel, onConfirm,
}: {
  botName: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Drawer open onClose={onCancel} title="確認停用機器人" width={480}>
      <div className="lbot-confirm">
        <p>
          即將停用 <b>{botName}</b> · webhook 事件不再處理。
        </p>
        <ul>
          <li>已收群組保留 · 可重新啟用</li>
          <li>此操作可還原 · 但期間新群無法自動偵測</li>
        </ul>
        <div className="llm-form-actions">
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}
            disabled={busy}
          >
            {busy ? "停用中…" : "確認停用"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>取消</button>
        </div>
      </div>
    </Drawer>
  );
}
