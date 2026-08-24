import type { ViewRole } from "./types";

// 權限管理的左側角色清單 · custom-roles v0.3 M6
// 從 Page.tsx 抽出來：加了「自建角色」那一區之後 Page 會超過 300 行紅線。

export default function RoleList({ builtin, custom, selected, onSelect, onCreate }: {
  builtin: ViewRole[];
  custom: ViewRole[];
  selected: string | null;
  onSelect: (sel: string) => void;
  onCreate: () => void;
}) {
  const item = (r: ViewRole) => (
    <button
      key={r.sel}
      className={`rm-role-item${selected === r.sel ? " active" : ""}`}
      onClick={() => onSelect(r.sel)}
    >
      <div className="rm-role-name">
        {r.name}
        <span className={`rm-role-badge ${r.isCustom || r.isCustomized ? "custom" : ""}`}>
          {r.isCustom ? "本公司自建" : r.isCustomized ? "已自行調整" : "系統預設"}
        </span>
      </div>
      <div className="rm-perm-meta">{r.permissions.length} 項權限 · {r.memberCount} 位成員</div>
      {/* 內建角色說「這個角色的人怎麼來的」；自建角色說「他看得到什麼」——
          資料範圍是自建角色唯一比內建多出來的概念，不標的話沒人知道 */}
      <div className="rm-role-source">{r.sourceHint}</div>
    </button>
  );

  return (
    <div className="rm-sidebar">
      <div className="rm-sidebar-hdr">內建角色（{builtin.length}）</div>
      {builtin.map(item)}

      <div className="rm-sidebar-hdr rm-group-gap">本公司自建（{custom.length}）</div>
      {custom.length === 0 ? (
        <div className="rm-empty-hint">
          還沒有自建角色<br />
          內建的「員工／部門主管」不夠用時再建 ——
          例如要一個「看得到全公司、但只能看不能核對」的角色。
        </div>
      ) : custom.map(item)}
      <button className="btn btn-ghost rm-create" onClick={onCreate}>＋ 建立角色</button>
    </div>
  );
}
