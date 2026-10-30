#!/usr/bin/env python3
"""「◯年前の今日のブログ」用データを事前生成する。

data/blogs/y*.json を読み、月日（MM-DD）ごとに過去の同月日の記事を
最大 MAX_PER_DAY 件まで選んで data/on-this-day.json に出力する。
トップページ（assets/js/home.js）が今日の月日のエントリを引いて表示する。

選定ルール（決定的）:
- 生成した年の記事は除外する（「◯年前」にならないため）
- 新しい年から優先しつつ、年がバラけるように年ごとに1件ずつ round-robin で拾う
- 同一年の中では、サムネイル有りを優先し、次に投稿時刻の遅いもの、同点なら id 順
"""
import glob
import json
import os
from datetime import date

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MAX_PER_DAY = 6


def pick_key(a):
    # 同一年内の優先順位: サムネイル有り → 時刻が遅い → id が小さい
    return (0 if a.get("thumb") else 1, _neg_time(a.get("time") or ""), a["id"])


def _neg_time(t):
    # "HH:MM" を「遅いほど小さい」キーに変換する（ゼロ埋め前提の文字列比較の逆転）
    parts = t.split(":")
    try:
        h, m = int(parts[0]), int(parts[1])
    except (ValueError, IndexError):
        h, m = 0, 0
    return -(h * 60 + m)


def main():
    this_year = date.today().year
    by_md = {}  # "MM-DD" -> {year: [articles]}
    files = sorted(glob.glob(os.path.join(ROOT, "data", "blogs", "y*.json")))
    for path in files:
        with open(path, encoding="utf-8") as f:
            articles = json.load(f)
        for a in articles:
            d = a.get("date") or ""
            if len(d) != 10:
                continue
            year = int(d[:4])
            if year >= this_year:
                continue
            md = d[5:]
            by_md.setdefault(md, {}).setdefault(year, []).append(a)

    out = {}
    for md, by_year in by_md.items():
        years = sorted(by_year, reverse=True)
        best = {}
        for y in years:
            best[y] = min(by_year[y], key=pick_key)
        picked = []
        for y in years:  # 新しい年から1件ずつ（=年がバラける）
            if len(picked) >= MAX_PER_DAY:
                break
            a = best[y]
            picked.append({
                "id": a["id"],
                "date": a["date"],
                "member": a.get("member") or "",
                "group": a.get("group") or "",
                "title": a.get("title") or "",
                "thumb": a.get("thumb") or "",
            })
        if picked:
            out[md] = picked

    dest = os.path.join(ROOT, "data", "on-this-day.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"on-this-day: {len(out)} days, "
          f"{sum(len(v) for v in out.values())} entries -> {dest}")


if __name__ == "__main__":
    main()
