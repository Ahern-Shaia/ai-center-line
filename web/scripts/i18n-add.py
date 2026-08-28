#!/usr/bin/env python3
"""把一批新的 i18n key 同時加進 zh-TW.ts 與 en.ts。

用法：
    python3 scripts/i18n-add.py <批次.json>

批次 JSON 的形狀：
    {"comment": "資料來源（settings/MasterData.tsx）",
     "keys": {"md.sub": {"zh": "…", "en": "…"}, …}}

⚠️ 兩個檔案的結尾是 `} satisfies Record<string, string>;`，不是 `};`。
   照 `};` 找錨點會 rfind 不到（第一版就這樣，整批沒寫進去）。

⚠️ 已存在的 key 會被跳過並印出來 —— 不覆蓋。
   同一個 key 出現兩次時 TS 物件取後者，靜默改掉既有翻譯是很難查的。
"""
import json
import pathlib
import sys

ANCHOR = "} satisfies Record<string, string>;"


def load_keys(path: pathlib.Path) -> set[str]:
    import re
    return set(re.findall(r'^\s*"([\w.\-]+)":', path.read_text(), re.M))


def main() -> int:
    batch = json.loads(pathlib.Path(sys.argv[1]).read_text())
    keys, comment = batch["keys"], batch.get("comment", "")
    here = pathlib.Path(__file__).resolve().parent.parent / "src" / "i18n"

    existing = load_keys(here / "zh-TW.ts") | load_keys(here / "en.ts")
    dup = [k for k in keys if k in existing]
    for k in dup:
        print(f"⚠️ 已存在，跳過：{k}")
    fresh = {k: v for k, v in keys.items() if k not in existing}
    if not fresh:
        print("沒有新的 key")
        return 0

    for lang, fname in (("zh", "zh-TW.ts"), ("en", "en.ts")):
        p = here / fname
        s = p.read_text()
        i = s.rfind(ANCHOR)
        if i < 0:
            print(f"❌ {fname} 找不到結尾錨點 {ANCHOR!r}", file=sys.stderr)
            return 1
        block = (f"\n  // {comment}\n" if comment else "\n") + "".join(
            "  {}: {},\n".format(json.dumps(k, ensure_ascii=False),
                                 json.dumps(v[lang], ensure_ascii=False))
            for k, v in fresh.items())
        p.write_text(s[:i].rstrip("\n") + "\n" + block + s[i:])

    print(f"✓ zh-TW.ts / en.ts 各加 {len(fresh)} 條"
          + (f"（跳過 {len(dup)} 條已存在）" if dup else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
