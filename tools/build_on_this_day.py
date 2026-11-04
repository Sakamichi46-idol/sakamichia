#!/usr/bin/env python3
"""「◯年前の今日のブログ」用データを事前生成する。

data/blogs/y*.json を読み、月日（MM-DD）ごとに過去の同月日の記事から
候補プールを最大 POOL_PER_DAY 件まで選んで data/on-this-day.json に出力する。
トップページ（assets/js/home.js）が今日の月日の候補を引き、サムネイル有りを
優先しながら毎回ランダムに MAX_PER_DAY 件を表示する。

選定ルール（決定的）:
- 生成した年の記事は除外する（「◯年前」にならないため）
- 年ごとに候補を「サムネイル有り → 投稿時刻の遅い順 → id 順」で並べ、
  新しい年から round-robin で拾う（年がバラけつつ、サムネ有りが先に集まる）
"""
import glob
import json
import os
from datetime import date

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MAX_PER_DAY = 6   # 表示側（home.js）が1回に出す件数
POOL_PER_DAY = 12  # データに持たせる候補数（表示側が毎回ランダムに選ぶ）


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
        for y in years:
            by_year[y].sort(key=pick_key)
        picked = []
        depth = 0
        while len(picked) < POOL_PER_DAY:
            progressed = False
            for y in years:  # 新しい年から round-robin（年がバラける）
                if depth < len(by_year[y]):
                    a = by_year[y][depth]
                    picked.append({
                        "id": a["id"],
                        "date": a["date"],
                        "member": a.get("member") or "",
                        "group": a.get("group") or "",
                        "title": a.get("title") or "",
                        "thumb": a.get("thumb") or "",
                    })
                    progressed = True
                    if len(picked) >= POOL_PER_DAY:
                        break
            if not progressed:
                break
            depth += 1
        if picked:
            out[md] = picked

    dest = os.path.join(ROOT, "data", "on-this-day.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    # 月別ファイルも出す：トップは当月分（約1/12）だけ読めば「今日の坂道」を出せる
    otd_dir = os.path.join(ROOT, "data", "on-this-day")
    os.makedirs(otd_dir, exist_ok=True)
    by_month = {}
    for md, entries in out.items():
        by_month.setdefault(md[:2], {})[md] = entries
    for mo, sub in by_month.items():
        with open(os.path.join(otd_dir, f"m{mo}.json"), "w", encoding="utf-8") as f:
            json.dump(sub, f, ensure_ascii=False, separators=(",", ":"))
    print(f"on-this-day: {len(out)} days, "
          f"{sum(len(v) for v in out.values())} entries -> {dest}")


if __name__ == "__main__":
    main()
