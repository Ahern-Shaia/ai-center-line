#!/usr/bin/env python3
"""把 docs/sop 的三份 HTML 手冊合併成單一可部署檔 戰情室操作手冊.html

  python3 docs/sop/build-手冊.py

⚠️ 合併檔是**生成的**，不要手改它 —— 改內容請改三份來源後重跑本腳本：
   導入-checklist.html / 權限設定-手冊.html / ragic-line-通知設定-手冊.html

三份來源的 CSS 有同名 class 衝突（.card/.note/.fld/table 定義不同），
本腳本把各自的選擇器加上 #g-chk / #g-perm / #g-ragic 前綴（:root/*/body 保留全域），
再包成分頁切換的單一頁（導入 Checklist 為預設首頁）。
"""
import re
import os

HERE = os.path.dirname(os.path.abspath(__file__))

def extract(path):
    s = open(os.path.join(HERE, path), encoding="utf-8").read()
    css = re.search(r"<style>(.*?)</style>", s, re.S).group(1)
    body = re.search(r"<body>(.*?)</body>", s, re.S).group(1)
    m = re.search(r'<div class="wrap">(.*)</div>\s*$', body.strip(), re.S)
    return css, (m.group(1) if m else body)

def prefix_css(css, ns):
    GLOBAL = ("*", "body", "html", ":root")
    def prefix_block(block):
        res = []
        for sel, bd in re.findall(r'([^{}]+)\{([^{}]*)\}', block):
            sel = sel.strip()
            if not sel:
                continue
            parts = []
            for one in (x.strip() for x in sel.split(",")):
                if not one:
                    continue
                head = one.split()[0].split(":")[0].split("[")[0]
                parts.append(one if (one.startswith(":root") or head in GLOBAL) else f"{ns} {one}")
            res.append(", ".join(parts) + "{" + bd + "}")
        return "\n".join(res)

    media = []
    flat = re.sub(r'@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}',
                  lambda m: media.append(m.group(0)) or f"@@M{len(media)-1}@@", css)
    out = prefix_block(flat)
    for mb in media:
        head = re.match(r'(@media[^{]*\{)', mb).group(1)
        out += "\n" + head + prefix_block(mb[len(head):-1]) + "}"
    return out

chk_css, chk_body = extract("導入-checklist.html")
rag_css, rag_body = extract("ragic-line-通知設定-手冊.html")
perm_css, perm_body = extract("權限設定-手冊.html")
shared_root = re.search(r':root\{[^}]*\}', perm_css).group(0)

html = f"""<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>aiproot 戰情室 · 操作手冊</title>
<!-- ⚠️ 生成檔，勿手改。改內容改兩份來源後重跑 docs/sop/build-手冊.py -->
<style>
  {shared_root}
  *{{box-sizing:border-box}}
  body{{margin:0;background:var(--bg);color:var(--ink);
    font-family:Inter,-apple-system,"Segoe UI","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;
    font-size:15px;line-height:1.75;-webkit-font-smoothing:antialiased;}}
  .hub{{position:sticky;top:0;z-index:10;background:rgba(246,247,249,.92);backdrop-filter:blur(8px);
    border-bottom:1px solid var(--line)}}
  .hub-in{{max-width:820px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}}
  .hub-brand{{font-weight:700;font-size:14px;color:var(--ink);margin-right:6px}}
  .hub-tab{{border:1px solid var(--line-strong);background:#fff;color:var(--ink-2);border-radius:8px;
    padding:7px 14px;font-size:13.5px;cursor:pointer;font-weight:600}}
  .hub-tab.on{{background:var(--brand);border-color:var(--brand);color:#fff}}
  .doc{{display:none}} .doc.on{{display:block}}
  #g-chk .wrap, #g-ragic .wrap, #g-perm .wrap{{max-width:820px;margin:0 auto;padding:32px 24px 80px}}
{prefix_css(chk_css, "#g-chk")}
{prefix_css(rag_css, "#g-ragic")}
{prefix_css(perm_css, "#g-perm")}
  @media print{{ .hub{{display:none}} .doc{{display:block !important}} }}
</style>
</head>
<body>
<div class="hub"><div class="hub-in">
  <span class="hub-brand">📘 操作手冊</span>
  <button class="hub-tab on" data-doc="g-chk">導入 Checklist</button>
  <button class="hub-tab" data-doc="g-perm">權限設定（總經理 / 部門主管）</button>
  <button class="hub-tab" data-doc="g-ragic">Ragic → LINE 通知設定</button>
</div></div>

<section class="doc on" id="g-chk"><div class="wrap">
{chk_body}
</div></section>

<section class="doc" id="g-perm"><div class="wrap">
{perm_body}
</div></section>

<section class="doc" id="g-ragic"><div class="wrap">
{rag_body}
</div></section>

<script>
  document.querySelectorAll('.hub-tab').forEach(function(b){{
    b.addEventListener('click', function(){{
      document.querySelectorAll('.hub-tab').forEach(function(x){{x.classList.remove('on')}});
      document.querySelectorAll('.doc').forEach(function(x){{x.classList.remove('on')}});
      b.classList.add('on');
      document.getElementById(b.dataset.doc).classList.add('on');
      window.scrollTo(0, 0);
    }});
  }});
</script>
</body>
</html>
"""
open(os.path.join(HERE, "戰情室操作手冊.html"), "w", encoding="utf-8").write(html)
print("已生成 戰情室操作手冊.html ·", len(html.splitlines()), "行")
