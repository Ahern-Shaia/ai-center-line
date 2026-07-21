import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button as AriaButton,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from "react-aria-components";
import {
  listLineBots,
  getLineBot,
  getLineRefs,
  createLineBot,
  updateLineBot,
  disableLineBot,
  patchLineGroup,
  probeLineGroupName,
  getSession,
  ApiError,
  type LineBotDto,
  type LineGroupRow,
  type LineRefsDto,
} from "./api";
import { useToast } from "./Toast";
import Drawer from "./Drawer";

type DrawerState = null | { kind: "new" } | { kind: "edit"; botId: string };

export default function LineBots() {
  const session = getSession();
  const canManage = session?.role === "aiproot_admin";
  const toast = useToast();

  const [bots, setBots] = useState<LineBotDto[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [botDetail, setBotDetail] = useState<{ bot: LineBotDto; groups: LineGroupRow[] } | null>(null);
  const [refs, setRefs] = useState<LineRefsDto>({ tenants: [], departments: [] });
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [confirmDisable, setConfirmDisable] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 初次載入 · 抓 bots + refs
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [botsRes, refsRes] = await Promise.all([listLineBots(), getLineRefs()]);
      setBots(botsRes.bots);
      setRefs(refsRes);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  // 從 URL hash 讀選中 · 支援 deep link
  useEffect(() => {
    const readHash = () => {
      const m = /^#\/line-bots\/([0-9a-f-]+)$/.exec(window.location.hash);
      if (m) setSelectedBotId(m[1]);
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  // 選中變更 · 拉 detail + 更新 URL hash
  useEffect(() => {
    if (!selectedBotId) {
      setBotDetail(null);
      if (window.location.hash.startsWith("#/line-bots/")) {
        window.location.hash = "#/line-bots";
      }
      return;
    }
    getLineBot(selectedBotId)
      .then((res) => setBotDetail(res))
      .catch((err) => {
        setSelectedBotId(null);
        toast.show(err instanceof ApiError ? err.message : "找不到機器人", "danger");
      });
    window.location.hash = `#/line-bots/${selectedBotId}`;
  }, [selectedBotId, toast]);

  const reloadDetail = useCallback(async () => {
    if (!selectedBotId) return;
    try {
      const res = await getLineBot(selectedBotId);
      setBotDetail(res);
      // 也刷新列表 (event count / verified 時間有變)
      const botsRes = await listLineBots();
      setBots(botsRes.bots);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "刷新失敗", "danger");
    }
  }, [selectedBotId, toast]);

  return (
    <div className="pane lbot-pane">
      <div className="lbot-hdr">
        <h1>LINE 機器人管理</h1>
        {canManage && (
          <button className="btn btn-primary" onClick={() => setDrawer({ kind: "new" })}>
            + 新增機器人
          </button>
        )}
      </div>

      <div className="lbot-split">
        <BotList
          bots={bots}
          selectedId={selectedBotId}
          onSelect={setSelectedBotId}
          loading={loading}
          canManage={canManage}
        />
        {selectedBotId && botDetail ? (
          <BotDetail
            detail={botDetail}
            refs={refs}
            canManage={canManage}
            onEdit={() => setDrawer({ kind: "edit", botId: selectedBotId })}
            onDisable={() => setConfirmDisable(selectedBotId)}
            onReload={reloadDetail}
          />
        ) : (
          <BotDetailEmpty canManage={canManage} onNew={() => setDrawer({ kind: "new" })} />
        )}
      </div>

      {drawer?.kind === "new" && (
        <NewBotDrawer
          refs={refs}
          onClose={() => setDrawer(null)}
          onCreated={(newBot) => {
            setDrawer(null);
            setBots((prev) => [newBot, ...prev]);
            setSelectedBotId(newBot.botId);
          }}
        />
      )}
      {drawer?.kind === "edit" && botDetail && (
        <EditBotDrawer
          bot={botDetail.bot}
          onClose={() => setDrawer(null)}
          onSaved={() => {
            setDrawer(null);
            reloadDetail();
          }}
        />
      )}

      {confirmDisable && (
        <DisableConfirmModal
          botName={botDetail?.bot.name ?? ""}
          onCancel={() => setConfirmDisable(null)}
          onConfirm={async () => {
            try {
              await disableLineBot(confirmDisable);
              toast.show("機器人已停用", "ok");
              setConfirmDisable(null);
              reloadDetail();
            } catch (err) {
              toast.show(err instanceof ApiError ? err.message : "停用失敗", "danger");
            }
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// 左 pane · Bot 列表
// ============================================================
function BotList({
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

// ============================================================
// 右 pane · Empty state
// ============================================================
function BotDetailEmpty({ canManage, onNew }: { canManage: boolean; onNew: () => void }) {
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

// ============================================================
// 右 pane · Bot Detail (Bot info collapsible + Groups table)
// ============================================================
function BotDetail({
  detail, refs, canManage, onEdit, onDisable, onReload,
}: {
  detail: { bot: LineBotDto; groups: LineGroupRow[] };
  refs: LineRefsDto;
  canManage: boolean;
  onEdit: () => void;
  onDisable: () => void;
  onReload: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const { bot, groups } = detail;

  const webhookUrl = `${window.location.origin.replace(/^http/, "https")}/api/line/webhook`;
  const verified = bot.webhookVerifiedAt != null;

  return (
    <section className="lbot-detail">
      {/* Bot info collapsible header */}
      <div className="lbot-info">
        <button
          className="lbot-info-hdr"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className={`lbot-chevron${expanded ? " open" : ""}`} aria-hidden>▸</span>
          <span className="lbot-info-name">{bot.name}</span>
          <span className={`lbot-status lbot-status--${bot.status === "active" ? (verified ? "on" : "pending") : "off"}`}>
            {bot.status === "disabled" ? "已停用" : verified ? "執行中" : "待驗證"}
          </span>
          {canManage && (
            <span className="lbot-info-actions" onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-sm" onClick={onEdit} disabled={bot.status === "disabled"}>編輯</button>
              <button className="btn btn-sm btn-danger" onClick={onDisable} disabled={bot.status === "disabled"}>停用</button>
            </span>
          )}
        </button>
        <div className="lbot-info-sub">
          <span>Channel {bot.channelId ?? "—"}</span>
          <span>·</span>
          <span>{bot.groupCount} 群</span>
          <span>·</span>
          <span>{verified ? `已驗證 ${formatRelative(bot.webhookVerifiedAt!)}` : "尚未收到 webhook"}</span>
        </div>

        {expanded && (
          <div className="lbot-info-body">
            <InfoRow label="Bot User ID" value={bot.botUserId} mono copy />
            <InfoRow label="Channel ID" value={bot.channelId ?? "—"} mono />
            <InfoRow label="Channel Secret" value={bot.channelSecretMasked} mono hint="由 aiproot 管" />
            <InfoRow label="Access Token" value={bot.channelAccessTokenMasked} mono hint="由 aiproot 管" />
            <InfoRow label="Webhook URL" value={webhookUrl} mono copy hint="貼回 LINE Developers Console" />
            <InfoRow label="首次驗證" value={bot.webhookVerifiedAt ? new Date(bot.webhookVerifiedAt).toLocaleString("zh-TW", { hour12: false }) : "—"} />
            <InfoRow label="建立於" value={new Date(bot.createdAt).toLocaleString("zh-TW", { hour12: false })} />
          </div>
        )}
      </div>

      {/* Groups list */}
      <div className="lbot-groups-hdr">
        <span className="lbot-groups-title">所有群組 <span className="lbot-groups-count">{groups.length}</span></span>
      </div>

      {groups.length === 0 ? (
        <div className="lbot-groups-empty">
          <div>Bot 尚未加入任何群</div>
          <div className="lbot-groups-empty-hint">加入後 groupId 會自動出現 · 通常群內任何訊息即觸發</div>
        </div>
      ) : (
        <table className="lbot-groups-tbl">
          <thead>
            <tr>
              <th>群顯示名稱</th>
              <th>Group ID</th>
              <th>分派部門</th>
              <th className="num">事件</th>
              <th>最近 event</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRow
                key={g.groupRegistryId}
                group={g}
                departments={refs.departments}
                canEdit={bot.status === "active"}
                onReload={onReload}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function GroupRow({
  group, departments, canEdit, onReload,
}: {
  group: LineGroupRow;
  departments: Array<{ departmentId: string; departmentName: string }>;
  canEdit: boolean;
  onReload: () => Promise<void>;
}) {
  const toast = useToast();
  const [probing, setProbing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const isLeft = group.status === "left";

  async function handleAssign(deptId: string | null) {
    setAssigning(true);
    try {
      await patchLineGroup(group.groupRegistryId, { departmentId: deptId });
      const target = deptId ? departments.find((d) => d.departmentId === deptId)?.departmentName : "未分派";
      toast.show(`已分派到 ${target}`, "ok");
      await onReload();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "分派失敗", "danger");
    } finally {
      setAssigning(false);
    }
  }

  async function handleProbe() {
    setProbing(true);
    try {
      const res = await probeLineGroupName(group.groupRegistryId);
      if (res.displayName) {
        toast.show(`已拉到群名：${res.displayName}`, "ok");
        await onReload();
      } else {
        toast.show("拉不到群名 · bot 需已加入群且有 chat 權限", "warn");
      }
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "拉群名失敗", "danger");
    } finally {
      setProbing(false);
    }
  }

  return (
    <tr className={isLeft ? "lbot-grp-left" : undefined}>
      <td>
        {group.displayName ? (
          <span>{group.displayName}</span>
        ) : (
          <button className="lbot-grp-probe" onClick={handleProbe} disabled={probing || isLeft}>
            {probing ? "拉取中…" : "（未命名）"}
          </button>
        )}
        {isLeft && <span className="lbot-tag lbot-tag--muted">已離開</span>}
      </td>
      <td className="mono truncate" title={group.groupId}>{group.groupId}</td>
      <td>
        <DepartmentSelect
          value={group.departmentId}
          departments={departments}
          onChange={handleAssign}
          disabled={!canEdit || assigning || isLeft}
        />
      </td>
      <td className="num mono">{group.eventCount}</td>
      <td className="lbot-grp-time">{formatRelative(group.lastEventAt)}</td>
      <td className="lbot-grp-actions">
        {group.displayName && !isLeft && (
          <button className="btn btn-sm btn-ghost" onClick={handleProbe} disabled={probing} title="重新拉群名">
            {probing ? "…" : "刷新名稱"}
          </button>
        )}
      </td>
    </tr>
  );
}

// ============================================================
// Department select · react-aria custom · 對照 LlmSettings ModelSelect
// ============================================================
function DepartmentSelect({
  value, departments, onChange, disabled,
}: {
  value: string | null;
  departments: Array<{ departmentId: string; departmentName: string }>;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const current = departments.find((d) => d.departmentId === value);
  const items = [
    { id: "__none__", name: "未分派" },
    ...departments.map((d) => ({ id: d.departmentId, name: d.departmentName })),
  ];
  return (
    <Select
      className="llm-select"
      selectedKey={value ?? "__none__"}
      onSelectionChange={(k) => {
        const v = String(k);
        onChange(v === "__none__" ? null : v);
      }}
      isDisabled={disabled}
      aria-label="分派部門"
    >
      <AriaButton className="llm-select-btn lbot-dept-btn">
        <SelectValue className="llm-select-value">
          {() => current?.departmentName ?? "未分派"}
        </SelectValue>
        <svg className="llm-select-chev" width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden>
          <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </AriaButton>
      <Popover className="llm-select-pop" offset={4}>
        <ListBox className="llm-select-list" items={items}>
          {(item) => (
            <ListBoxItem id={item.id} textValue={item.name} className="llm-select-item">
              <span>{item.name}</span>
              <svg className="llm-select-check" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="m2 7 3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}

// ============================================================
// 新增 Bot Drawer (aiproot_admin only)
// ============================================================
function NewBotDrawer({
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

// ============================================================
// 編輯 Bot Drawer (aiproot_admin only)
// ============================================================
function EditBotDrawer({
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

// ============================================================
// 停用確認 Modal
// ============================================================
function DisableConfirmModal({
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

// ============================================================
// helpers
// ============================================================
function InfoRow({ label, value, mono, copy, hint }: {
  label: string;
  value: string;
  mono?: boolean;
  copy?: boolean;
  hint?: string;
}) {
  const toast = useToast();
  return (
    <div className="lbot-info-row">
      <div className="lbot-info-lbl">{label}</div>
      <div className={`lbot-info-val${mono ? " mono" : ""}`}>
        {value}
        {copy && (
          <button
            className="lbot-copy"
            onClick={() => {
              navigator.clipboard.writeText(value);
              toast.show("已複製", "ok");
            }}
            title="複製"
          >
            複製
          </button>
        )}
      </div>
      {hint && <div className="lbot-info-hint">{hint}</div>}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
}
