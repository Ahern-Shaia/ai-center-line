import { useMemo, useState } from "react";
import { DEPT_ROWS, MEMBERS } from "../mockdata/departments";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate().toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export default function DepartmentsMembers() {
  const [tab, setTab] = useState<"dept" | "member">("dept");

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>部門 / 成員</h1>
          <div className="sub">LINE 群組配置 · 抽取結構 · 群組負責人與成員維護（此頁面唯讀，正式版可新增／調整）</div>
        </div>
      </div>

      <div className="dm-tabs">
        <button className={`dm-tab${tab === "dept" ? " active" : ""}`} onClick={() => setTab("dept")}>
          部門配置<span className="dm-tab-count">{DEPT_ROWS.length}</span>
        </button>
        <button className={`dm-tab${tab === "member" ? " active" : ""}`} onClick={() => setTab("member")}>
          成員<span className="dm-tab-count">{MEMBERS.length}</span>
        </button>
      </div>

      {tab === "dept" && <DeptTable />}
      {tab === "member" && <MemberList />}
    </>
  );
}

function DeptTable() {
  return (
    <div className="dm-table-wrap">
      <table className="dm-table">
        <thead>
          <tr>
            <th>代碼</th>
            <th>部門名</th>
            <th>LINE 群組 ID</th>
            <th>抽取結構</th>
            <th>對應記錄類型</th>
            <th>群組負責人</th>
            <th>成員</th>
            <th>狀態</th>
          </tr>
        </thead>
        <tbody>
          {DEPT_ROWS.map((d) => (
            <tr key={d.code}>
              <td className="mono">{d.code}</td>
              <td className="dm-td-name">{d.name}</td>
              <td className="mono dm-td-groupid">{d.lineGroupId}</td>
              <td className="dm-td-schema">{d.extractionSchema}</td>
              <td>{d.recordCategory}</td>
              <td>{d.ownerName}</td>
              <td className="mono">{d.memberCount}</td>
              <td>{d.active ? <span className="tag ok">啟用</span> : <span className="tag muted">停用</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberList() {
  const byDept = useMemo(() => {
    const m = new Map<string, typeof MEMBERS>();
    for (const dept of DEPT_ROWS) {
      m.set(dept.code, MEMBERS.filter((mb) => mb.dept === dept.code));
    }
    return m;
  }, []);

  return (
    <div className="dm-member-groups">
      {DEPT_ROWS.map((dept) => {
        const list = byDept.get(dept.code) ?? [];
        return (
          <div key={dept.code} className="dm-member-group">
            <div className="dm-member-group-hdr">
              <span className="dm-member-group-name">{dept.name}</span>
              <span className="dm-member-group-count">{list.length} 位</span>
            </div>
            <div className="dm-member-list">
              {list.map((mb, i) => (
                <div key={`${mb.dept}-${i}`} className="dm-member-item">
                  <div className="dm-member-name">
                    {mb.name}
                    {mb.role === "群組負責人" && <span className="tag ok" style={{ marginLeft: 6 }}>負責人</span>}
                    {mb.role === "跨群支援" && <span className="tag muted" style={{ marginLeft: 6 }}>跨群</span>}
                  </div>
                  <div className="dm-member-meta">
                    <span className="mono">{mb.lineHandle}</span>
                    <span className="dm-member-dot">·</span>
                    <span>入群 {mb.joinedAt}</span>
                    <span className="dm-member-dot">·</span>
                    <span>最近進線 <span className="mono">{fmtDateTime(mb.lastActiveAt)}</span></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
