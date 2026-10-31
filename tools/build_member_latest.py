#!/usr/bin/env python3
"""メンバーごとの最新ブログ記事の小さな索引 data/member-latest.json を生成する。

トップページの「推しの新着」用。トップで年別ブログファイル全量を読まずに済むよう、
メンバーごとに最新 MAX_PER_MEMBER 件だけを抜き出しておく。
build_on_this_day.py と同じく daily ワークフローで再生成される。

出力形式: {メンバー名: [{"id","date","title","thumb","group"}, ...]}（新しい順）
対象は data/members.json の名簿に載っている名前のみ。
"""
import glob
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MAX_PER_MEMBER = 3


def sort_key(a):
    # 新しい順：日付 → 時刻 → id（いずれも文字列の辞書順で降順に使う）
    return (a.get("date") or "", a.get("time") or "", a.get("id") or "")


def main():
    with open(os.path.join(ROOT, "data", "members.json"), encoding="utf-8") as f:
        roster = {m["name"] for m in json.load(f)}

    latest = {}  # name -> [articles]
    files = sorted(glob.glob(os.path.join(ROOT, "data", "blogs", "y*.json")))
    for path in files:
        with open(path, encoding="utf-8") as f:
            articles = json.load(f)
        for a in articles:
            name = a.get("member") or ""
            if name not in roster or not a.get("id") or not a.get("date"):
                continue
            entry = {
                "id": a["id"],
                "date": a["date"],
                "title": a.get("title") or "",
                "thumb": a.get("thumb") or "",
                "group": a.get("group") or "",
            }
            lst = latest.setdefault(name, [])
            lst.append((sort_key(a), entry))
    out = {}
    for name, lst in latest.items():
        lst.sort(key=lambda x: x[0], reverse=True)
        out[name] = [e for _, e in lst[:MAX_PER_MEMBER]]

    dest = os.path.join(ROOT, "data", "member-latest.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"member-latest: {len(out)} members, "
          f"{sum(len(v) for v in out.values())} entries -> {dest}")


if __name__ == "__main__":
    main()
