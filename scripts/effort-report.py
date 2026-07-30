#!/usr/bin/env python3
"""從 git 歷史推估投入工時 · 產出 docs/開發工時.md 的表格

  python3 scripts/effort-report.py

⚠️ 為什麼不是用「每日第一筆到最後一筆」的跨距：
   那個算法在本專案的資料上算出 244 小時，其中 106.5 小時是**日內空檔**
   （2026-07-21 有一個 15.5 小時的洞、07-05 有一個 10.9 小時的洞）——
   那些是睡覺不是工作。作息不規律 + 常跨午夜的專案，按日曆天切會失真。
   所以切在「連續工作段」：相鄰 commit 間隔超過 GAP 就視為換一段。
"""
import collections
import datetime
import re
import subprocess

GAP = 90 * 60      # 相鄰 commit 超過這個間隔 → 換一段工作
LEAD = 20 * 60     # 每段第一筆 commit 之前的作業時間（想、查、讀 code）

out = subprocess.run(
    ["git", "log", "--format=%at|%s"], capture_output=True, text=True, check=True).stdout
commits = sorted((int(a), b) for a, b in
                 (l.split("|", 1) for l in out.splitlines() if l.strip()))


def at(t: int) -> datetime.datetime:
    return datetime.datetime.fromtimestamp(t)


sessions = []
start = prev = commits[0][0]
count = 1
for t, _ in commits[1:]:
    if t - prev > GAP:
        sessions.append((start, prev, count))
        start, count = t, 1
    else:
        count += 1
    prev = t
sessions.append((start, prev, count))

hours = sum(b - a for a, b, _ in sessions) / 3600
days = {at(a).date() for a, _, _ in sessions}

print(f"期間      ：{at(commits[0][0]).date()} ~ {at(commits[-1][0]).date()}")
print(f"commit    ：{len(commits)}")
print(f"有效天數  ：{len(days)}")
print(f"工作段    ：{len(sessions)}（{sum(1 for a, b, _ in sessions if at(a).date() != at(b).date())} 段跨午夜）")
print(f"工時（段內）：{hours:.1f} h")
print(f"工時（＋每段前置 {LEAD // 60} 分）：{hours + len(sessions) * LEAD / 3600:.1f} h")

# 對照組：每日首末跨距（本專案不適用，列出來是為了說明差在哪）
byday = collections.defaultdict(list)
for t, _ in commits:
    byday[at(t).date()].append(t)
naive = sum(max(v) - min(v) for v in byday.values()) / 3600
print(f"（對照）每日首末跨距：{naive:.1f} h ← 含日內空檔，本專案不採用")

print("\n### 逐日")
print("| 日期 | 工作段 | commit | 時段 | 工時(h) |")
print("|---|---|---|---|---|")
for day in sorted(days):
    mine = [s for s in sessions if at(s[0]).date() == day]
    span = " / ".join(
        f"{at(a):%H:%M}–{at(b):%H:%M}" + ("(+1)" if at(a).date() != at(b).date() else "")
        for a, b, _ in mine)
    print(f"| {day} | {len(mine)} | {sum(c for _, _, c in mine)} | {span} | "
          f"{sum(b - a for a, b, _ in mine) / 3600:.1f} |")

# scope 歸屬：每筆 commit 的成本＝與前一筆的間隔（段首記 0）。
# 這樣加總會剛好等於段內工時，不會因為換算方式而多出或少掉時間。
print("\n### 依 commit scope")
cost: collections.Counter = collections.Counter()
n: collections.Counter = collections.Counter()
prev = None
for t, subject in commits:
    m = re.match(r"^\w+\(([^)]+)\)", subject)
    scope = m.group(1) if m else "(無 scope)"
    if prev is not None and t - prev <= GAP:
        cost[scope] += (t - prev) / 3600
    n[scope] += 1
    prev = t
print("| scope | commit | 工時(h) | 占比 |")
print("|---|---|---|---|")
for k, v in cost.most_common(15):
    print(f"| {k} | {n[k]} | {v:.1f} | {v / hours * 100:.1f}% |")
rest = [k for k in cost if k not in dict(cost.most_common(15))]
print(f"| 其餘 {len(rest)} 個 scope | {sum(n[k] for k in rest)} | "
      f"{sum(cost[k] for k in rest):.1f} | {sum(cost[k] for k in rest) / hours * 100:.1f}% |")
