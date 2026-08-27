#!/usr/bin/env python3
"""智慧巡檢 CSV 體檢 —— docs/modules/smart-inspection.md §2 的數字由這支產生。

用法：
    python3 scripts/inspection-probe.py ~/Downloads/智慧巡檢

⚠️ 這支只**量測**，不修資料、不寫檔。目的是回答一個問題：
   「現行 CSV 的『狀態』欄能不能直接拿來畫燈號？」

⚠️ 三個踩過的坑，寫在這裡免得下次重踩：
   1. **編碼**：檔案是 UTF-8 帶 BOM，且**尾端可能截斷**（半個字元）。
      `encoding="utf-8-sig"` 還會炸，要再加 `errors="replace"`。
   2. **檔案中間混進表頭列**：有檔案在資料中間又出現一次
      `時間,相機名稱,...`，會被 DictReader 當成資料列。要按 `時間` 欄過濾。
   3. **「用該台自己的中位間隔當基準」會讓長期壞掉的相機看起來正常**
      —— .106 / .144 一小時才回報一次，它們的中位數就是 3600s，於是「準時」。
      本腳本照樣印出來，但**標記為觀測值基準**（見 smart-inspection.md §2.4 / OQ-SI-3）。
"""
import csv
import collections
import os
import statistics
import sys
from datetime import datetime
from glob import glob

# 判「連續兩筆差一個小數位」的比值窗。10 倍上下留裕度，避免抓到真的變化。
TENX_LO, TENX_HI = 8.0, 12.0


# ⚠️⚠️ **時間格式不只一種。**
#    多數檔是 `2026-08-25 14:42:10`，但 .144 整批是 `2026/8/25 16:42`
#    （斜線、月日不補零、沒有秒）。第一版只認前者，於是把 .144 前兩天的資料
#    **整批靜默丟掉**，導致我在 M0 初稿誤判「這台相機停止回報」——
#    實際上它一直在報，只是換了一個寫檔器。
#    → 解析失敗**必須計數並印出來**，不可以 `continue` 就算了。
TIME_FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M")


def parse_time(t: str):
    for fmt in TIME_FORMATS:
        try:
            return datetime.strptime(t, fmt)
        except ValueError:
            continue
    return None


def load(root: str) -> tuple[list[dict], list[tuple[str, str]]]:
    rows: list[dict] = []
    unparsed: list[tuple[str, str]] = []
    for path in sorted(glob(os.path.join(root, "*.csv"))):
        stem = os.path.basename(path)[:-4]
        if "_" not in stem:
            print(f"  ⚠️ 檔名不是 <IP>_<日期>.csv，跳過：{stem}", file=sys.stderr)
            continue
        ip, date = stem.rsplit("_", 1)
        with open(path, encoding="utf-8-sig", errors="replace") as fh:
            for r in csv.DictReader(fh):
                # `\ufeff` —— 混在檔案中間的那一列表頭自己也帶 BOM
                t = (r.get("時間") or "").strip().lstrip("\ufeff")
                if not t or t == "時間":   # 坑 2：中間混進來的表頭列
                    continue
                r["_t"] = parse_time(t)
                if r["_t"] is None:
                    unparsed.append((os.path.basename(path), t))
                    continue
                try:
                    r["_v"] = float(r["辨識數值"])
                except (TypeError, ValueError):
                    r["_v"] = None      # 缺漏一律 None，禁止當 0（R11）
                r["_ip"], r["_date"] = ip, date
                rows.append(r)
    return rows, unparsed



# ══════════════════════════════════════════════════════════════════
# --emit-js · 產出 shianyong-warroom.html 要用的 INSP 靜態資料
#   docs/modules/smart-inspection.md M1 / A1
# ══════════════════════════════════════════════════════════════════

BUCKETS = 120   # 讀數曲線的取樣點數


def classify(rs: list, span_end, med_gap: float, tenx_ratio: float, vals: list) -> str:
    """燈號。⚠️ 判準是**觀測值**不是工程量程（OQ-SI-2/3 未到）—— 畫面上必須標明。"""
    silent = (span_end - rs[-1]["_t"]).total_seconds()
    if silent > med_gap * 20 and silent > 600:
        return "r"
    if tenx_ratio > 10 or (vals and max(map(abs, vals)) > 1000):
        return "y"
    return "g"


def series(rs: list, t0, t1) -> list:
    """把整個觀測窗切成 BUCKETS 個時間桶，各取中位數。

    ⚠️ **空桶留 None 不要內插** —— 那個洞就是「這段時間沒回報」，
       內插會把停止回報畫成一條平順的線，正好抹掉我們最想讓人看到的事。
    """
    total = (t1 - t0).total_seconds() or 1
    buckets: list[list[float]] = [[] for _ in range(BUCKETS)]
    for r in rs:
        if r["_v"] is None:
            continue
        i = min(BUCKETS - 1, int((r["_t"] - t0).total_seconds() / total * BUCKETS))
        buckets[i].append(r["_v"])
    return [round(statistics.median(b), 2) if b else None for b in buckets]


def emit_js(rows: list) -> str:
    import json
    by: dict[str, list] = collections.defaultdict(list)
    for r in rows:
        by[r["_ip"]].append(r)
    t0 = min(r["_t"] for r in rows)
    t1 = max(r["_t"] for r in rows)

    cams = []
    for ip in sorted(by, key=lambda x: [int(o) for o in x.split(".")]):
        rs = by[ip]
        vals = [r["_v"] for r in rs if r["_v"] is not None]
        gaps = [(rs[i + 1]["_t"] - rs[i]["_t"]).total_seconds() for i in range(len(rs) - 1)]
        med_gap = statistics.median(gaps) if gaps else 0.0

        t10 = t_tot = 0
        pv = None
        for v in vals:
            if pv is not None and abs(pv) > 0.05 and abs(v) > 0.05:
                t_tot += 1
                lo, hi = sorted((abs(pv), abs(v)))
                if TENX_LO <= hi / lo <= TENX_HI:
                    t10 += 1
            pv = v
        ratio = round(t10 / t_tot * 100) if t_tot else 0

        # 圖表 y 軸範圍：**中位數 ± 4×MAD**。
        #
        # ⚠️ 走過兩版都不對，記在這裡：
        #  v1 取 |v| 的 P99 做 ±cap 對稱夾 → 單邊分佈（camera_06 全負、中位 −22
        #     但有幾筆 −521）被拉成 −500 ~ −20，整條線貼在頂端變成一條直線。
        #  v2 改成帶正負號的 P2/P98 → **小樣本失效**：camera_06 只有 48 筆，
        #     2% 就是索引 0，等於沒夾。
        #  MAD 對樣本數與單邊分佈都不敏感，而且離群值多寡不影響它。
        med_v = statistics.median(vals) if vals else 0.0
        mad = statistics.median([abs(v - med_v) for v in vals]) if vals else 0.0
        halfspan = max(mad * 4, abs(med_v) * 0.08, 0.5)
        q02, q98 = med_v - halfspan, med_v + halfspan
        cams.append({
            "ip": ip,
            "name": rs[0]["相機名稱"],
            # ⚠️ of/x/y 是形狀 A（平面圖圖層）用的，要客戶給對應表才填（OQ-SI-2 / §5）
            "of": None, "x": None, "y": None,
            "s": classify(rs, t1, med_gap, ratio, vals),
            "last": rs[-1]["_t"].strftime("%m-%d %H:%M"),
            "iv": round(med_gap),
            # 距離快照結束多久沒回報。⚠️ 卡片上只寫「最後回報 13:40」看不出嚴不嚴重 ——
            # 別台是 13:56，差 16 分；但這台正常每 18s 一筆，16 分就是斷了 53 個週期。
            "sil": round((t1 - rs[-1]["_t"]).total_seconds()),
            "n": len(rs),
            "v": round(statistics.median(vals), 1) if vals else None,
            "lo": round(min(vals), 1) if vals else None,
            "hi": round(max(vals), 1) if vals else None,
            "tenx": ratio,
            "q02": round(q02, 2), "q98": round(q98, 2),
            # 圖表桶寬（秒）· 取樣間隔 > 桶寬的相機，線段本來就會斷，
            # 那不是「沒回報」—— 前端要靠這個值分辨（不然會把正常降頻講成故障）
            "bw": round((t1 - t0).total_seconds() / BUCKETS),
            "sr": series(rs, t0, t1),
        })

    meta = {
        "from": t0.strftime("%Y-%m-%d %H:%M"),
        "to": t1.strftime("%Y-%m-%d %H:%M"),
        "total": len(rows),
        # 現行 CSV 那個 99.3% 的「異常」數 —— **只放在資料裡供對照，不上畫面**（OQ-SI-6）
        "csvAbnormal": sum(1 for r in rows if r["狀態"].startswith("[異常]")),
        "bw": round((t1 - t0).total_seconds() / BUCKETS),
        "generatedFrom": "scripts/inspection-probe.py --emit-js",
    }
    return ("/* ⚠️ 自動產生 —— 不要手改。\n"
            "   來源：scripts/inspection-probe.py --emit-js ~/Downloads/智慧巡檢\n"
            "   這是 2026-08-25~27 的**死資料快照**，不會更新（smart-inspection.md 檔頭①）。*/\n"
            "const INSP=" + json.dumps({"meta": meta, "cam": cams}, ensure_ascii=False, separators=(",", ":")) + ";")


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = args[0] if args else os.path.expanduser("~/Downloads/智慧巡檢")
    rows, unparsed = load(root)
    if not rows:
        print(f"❌ {root} 沒有讀到任何資料", file=sys.stderr)
        return 1
    rows.sort(key=lambda r: (r["_ip"], r["_t"]))

    if "--emit-js" in sys.argv:
        print(emit_js(rows))
        return 0

    span = (min(r["_t"] for r in rows), max(r["_t"] for r in rows))
    days = max((span[1] - span[0]).total_seconds() / 86400, 1e-9)
    abnormal = sum(1 for r in rows if r["狀態"].startswith("[異常]"))

    print(f"═══ 智慧巡檢體檢 · {root}")
    print(f"    {span[0]:%Y-%m-%d %H:%M} → {span[1]:%Y-%m-%d %H:%M}（{days:.1f} 天）\n")
    print(f"總筆數        {len(rows):,}")
    print(f"標成「[異常]」 {abnormal:,}  = {abnormal / len(rows) * 100:.1f}%   "
          f"← 一天 {abnormal / days:,.0f} 件")
    print(f"標成「正常」   {sum(1 for r in rows if r['狀態'] == '正常'):,}")

    # 小數點位數判讀不一致
    tenx = tot = 0
    prev: dict = {}
    for r in rows:
        k = (r["_ip"], r["相機名稱"], r["ROI名稱"])
        v, pv = r["_v"], prev.get(k)
        if v is not None and pv is not None and abs(pv) > 0.05 and abs(v) > 0.05:
            tot += 1
            lo, hi = sorted((abs(pv), abs(v)))
            if TENX_LO <= hi / lo <= TENX_HI:
                tenx += 1
        if v is not None:
            prev[k] = v
    print(f"連續兩筆差 {TENX_LO:.0f}–{TENX_HI:.0f} 倍（小數點判讀不一致）"
          f"  {tenx:,}/{tot:,} = {tenx / tot * 100:.1f}%")
    if unparsed:
        import collections as _c
        print(f"\n⚠️ 時間解析失敗 {len(unparsed):,} 列 —— 這些資料**沒有進入以下統計**：")
        for f, t in list(_c.Counter(unparsed).items())[:5]:
            print(f"     {f}  {t!r}")
    print()

    # 資料衛生
    print("── 資料衛生")
    print(f"  Modbus位址 有值        {sum(1 for r in rows if (r.get('Modbus位址') or '').strip()):,} / {len(rows):,}")
    print(f"  相機名稱               {sorted({r['相機名稱'] for r in rows})}")
    print(f"  ROI名稱                {sorted({r['ROI名稱'] for r in rows})}\n")

    by: dict[str, list] = collections.defaultdict(list)
    for r in rows:
        by[r["_ip"]].append(r)

    print("── 逐台（⚠️ 燈號的『停止回報』基準是**觀測中位間隔**，非設計取樣率 · OQ-SI-3）")
    hdr = f"{'IP':<17}{'相機':<11}{'筆數':>7}{'中位間隔':>9}{'最後回報':>13}{'讀數中位':>10}{'10×':>6}  燈號"
    print(hdr)
    print("─" * len(hdr))
    lights = collections.Counter()
    for ip in sorted(by):
        rs = by[ip]
        vs = [r["_v"] for r in rs if r["_v"] is not None]
        gaps = [(rs[i + 1]["_t"] - rs[i]["_t"]).total_seconds() for i in range(len(rs) - 1)]
        med_gap = statistics.median(gaps) if gaps else 0.0

        t10 = t_tot = 0
        pv = None
        for v in vs:
            if pv is not None and abs(pv) > 0.05 and abs(v) > 0.05:
                t_tot += 1
                lo, hi = sorted((abs(pv), abs(v)))
                if TENX_LO <= hi / lo <= TENX_HI:
                    t10 += 1
            pv = v
        ratio = t10 / t_tot * 100 if t_tot else 0.0

        silent = (span[1] - rs[-1]["_t"]).total_seconds()
        if silent > med_gap * 20 and silent > 600:
            light = "🔴 停止回報"
        elif ratio > 10 or (vs and max(map(abs, vs)) > 1000):
            light = "🟡 讀數不可信"
        else:
            light = "🟢 正常"
        lights[light] += 1
        print(f"{ip:<17}{rs[0]['相機名稱']:<11}{len(rs):>7,}{med_gap:>8.0f}s"
              f"{rs[-1]['_t'].strftime('%m-%d %H:%M'):>13}{statistics.median(vs):>10.1f}{ratio:>5.0f}%  {light}")

    print()
    for k, v in lights.most_common():
        print(f"  {k}  {v} 台")
    if len(lights) == 1:
        print("\n  ⚠️ 燈號全同色 —— 判準壞了，不是現場真的全好或全壞（smart-inspection.md §10）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
