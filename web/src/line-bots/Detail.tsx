import { useEffect, useState } from "react";
import {
  Button as AriaButton,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from "react-aria-components";
import {
  patchLineGroup,
  probeLineGroupName,
  ApiError,
  type LineBotDto,
  type LineGroupRow,
  type LineRefsDto,
} from "../api";
import { useToast } from "../Toast";
import { formatRelative } from "./utils";

type Department = { departmentId: string; departmentName: string };

// 右 pane · Bot Detail（Bot info collapsible + Groups table）
export function BotDetail({
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

  // prod：VITE_API_BASE_URL 指向 backend · dev：走 Vite proxy 打 localhost:3000
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? window.location.origin;
  const webhookUrl = `${apiBase}/line/webhook`;
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
            <InfoRow label="隸屬租戶" value={refs.tenants.find((t) => t.tenantId === bot.tenantId)?.tenantName ?? bot.tenantId} hint="編輯機器人可遷移到其他租戶" />
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
          <div>此機器人尚未加入任何群</div>
          <div className="lbot-groups-empty-hint">加入群組後 · 群內任何訊息即可觸發自動載入</div>
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
  departments: Department[];
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
        toast.show("拉不到群名 · LINE 官方帳號需已加入群且有聊天權限", "warn");
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
        <GroupNameCell group={group} disabled={!canEdit || isLeft} onSaved={onReload} />
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
        {!isLeft && (
          <button className="btn btn-sm btn-ghost" onClick={handleProbe} disabled={probing} title="呼叫 LINE API 同步群顯示名稱">
            {probing ? "同步中…" : "同步群名"}
          </button>
        )}
      </td>
    </tr>
  );
}

// 群名 inline 編輯 · 手動輸入為主 · 從 LINE 拉為輔（行動列另有按鈕）
function GroupNameCell({
  group, disabled, onSaved,
}: {
  group: LineGroupRow;
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const original = group.displayName ?? "";
  const [value, setValue] = useState(original);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(group.displayName ?? ""); }, [group.displayName]);

  async function commit() {
    const v = value.trim();
    if (v === original) return;
    if (!v) { setValue(original); return; }
    setSaving(true);
    try {
      await patchLineGroup(group.groupRegistryId, { displayName: v });
      toast.show(`群名已更新：${v}`, "ok");
      await onSaved();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "更新失敗", "danger");
      setValue(original);
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      type="text"
      className="lbot-grp-name-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { (e.currentTarget as HTMLInputElement).blur(); }
        else if (e.key === "Escape") { setValue(original); (e.currentTarget as HTMLInputElement).blur(); }
      }}
      disabled={disabled || saving}
      placeholder="點擊輸入群名"
      spellCheck={false}
    />
  );
}

// Department select · react-aria custom · 對照 LlmSettings ModelSelect
function DepartmentSelect({
  value, departments, onChange, disabled,
}: {
  value: string | null;
  departments: Department[];
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

// 展開狀態下的一列 Bot 詳細資訊
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
