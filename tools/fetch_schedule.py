#!/usr/bin/env python3
"""公式スケジュール（メディア出演等）を取得して data/schedule.json を作る。

取得元は3グループ公式サイトのスケジュール一覧（月別）。
載せるのは事実情報（日付・時刻・種別・番組名/イベント名・出演メンバー）だけ。
取得に失敗したグループは前回データを保持する（ニュース取得と同じ方針）。
"""
import json
import re
import subprocess
import sys
from datetime import date, timedelta
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "schedule.json"
UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"
GROUPS = ["乃木坂46", "櫻坂46", "日向坂46"]


def fetch(url: str) -> str:
    for _ in range(2):
        r = subprocess.run(
            ["curl", "-sL", "--max-time", "40", "-A", UA, url],
            capture_output=True, text=True)
        if r.returncode == 0 and r.stdout:
            return r.stdout
    return ""


def clean(s: str) -> str:
    return unescape(re.sub(r"<[^>]+>", "", s or "")).replace("\xa0", " ").strip()


def name_norm(s: str) -> str:
    return re.sub(r"\s+", "", clean(s))


def months() -> list[str]:
    t = date.today()
    nxt = (t.replace(day=28) + timedelta(days=8)).replace(day=1)
    return [t.strftime("%Y%m"), nxt.strftime("%Y%m")]


def parse_sakura(ym: str) -> list[dict]:
    h = fetch(f"https://sakurazaka46.com/s/s46/media/list?dy={ym}")
    if not h:
        return []
    items = []
    for b in re.split(r"js-schedule-detail", h)[1:]:
        md = re.search(r'class="date wf-a">([^<]+)</p>', b)
        mt = re.search(r'<p class="type">([^<]+)</p>', b)
        mti = re.search(r'<h2 class="title">([^<]+)</h2>', b)
        if not (md and mt and mti):
            continue
        dt = clean(md.group(1))
        m = re.match(r"(\d{4})\.(\d{2})\.(\d{2})\s*(.*)", dt)
        if not m:
            continue
        dstr = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        mem = re.findall(r'<ul class="members[^"]*">(.*?)</ul>', b, re.S)
        names = []
        if mem:
            names = [name_norm(x) for x in re.findall(r"<li>(.*?)</li>", mem[0], re.S)]
        items.append({
            "_date": dstr,
            "g": "櫻坂46", "kind": clean(mt.group(1)), "time": m.group(4).strip(),
            "title": clean(mti.group(1)), "members": [n for n in names if n],
            "url": "https://sakurazaka46.com/s/s46/media/list",
        })
    return items


def parse_hinata(ym: str, detail_window: tuple[date, date]) -> list[dict]:
    h = fetch(f"https://www.hinatazaka46.com/s/official/media/list?dy={ym}")
    if not h:
        return []
    year, month = int(ym[:4]), int(ym[4:])
    items = []
    for g in re.split(r"c-schedule__date--list", h)[1:]:
        md = re.search(r"<span>(\d+)</span>", g)
        if not md:
            continue
        dstr = f"{year:04d}-{month:02d}-{int(md.group(1)):02d}"
        for li in re.findall(r'p-schedule__item">(.*?)</li>', g, re.S):
            cat = re.search(r'c-schedule__category[^>]*>\s*([^<]+?)\s*</div>', li)
            tim = re.search(r'c-schedule__time--list">\s*([^<]+?)\s*</div>', li)
            txt = re.search(r'c-schedule__text">\s*(.*?)\s*</p>', li, re.S)
            did = re.search(r"/media/detail/(\d+)", li)
            if not txt:
                continue
            it = {
                "_date": dstr,
                "g": "日向坂46", "kind": clean(cat.group(1)) if cat else "",
                "time": clean(tim.group(1)) if tim else "",
                "title": clean(txt.group(1)), "members": [],
                "url": (f"https://www.hinatazaka46.com/s/official/media/detail/{did.group(1)}"
                        if did else "https://www.hinatazaka46.com/s/official/media/list"),
            }
            # 出演メンバーは詳細ページにある。表示に使う近い日だけ取りに行く
            try:
                d = date.fromisoformat(dstr)
            except ValueError:
                d = None
            if did and d and detail_window[0] <= d <= detail_window[1]:
                dh = fetch(it["url"])
                tag = re.search(r'c-article__tag"><b>メンバー</b>(.*?)</div>', dh, re.S)
                if tag:
                    it["members"] = [name_norm(x) for x in
                                     re.findall(r"<a [^>]*>([^<]+)</a>", tag.group(1))]
            items.append(it)
    return items


def start_key(it: dict) -> tuple:
    m = re.search(r"(\d{1,2}):(\d{2})", it.get("time") or "")
    t = (int(m.group(1)) * 60 + int(m.group(2))) if m else 9999
    g = GROUPS.index(it["g"]) if it["g"] in GROUPS else 9
    return (g, t)


def main() -> int:
    today = date.today()
    window = (today, today + timedelta(days=10))
    prev = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8")).get("days", {})
        except Exception:
            prev = {}

    fetched: dict[str, list[dict]] = {}
    got = {}
    for ym in months():
        s = parse_sakura(ym)
        if s:
            got.setdefault("櫻坂46", []).extend(s)
        hz = parse_hinata(ym, window)
        if hz:
            got.setdefault("日向坂46", []).extend(hz)
    # 取得できたグループは当月・翌月分を入れ替え、失敗したグループは前回分を保持
    months_prefix = tuple(m[:4] + "-" + m[4:] for m in months())
    days: dict[str, list[dict]] = {}
    for dstr, lst in prev.items():
        keep = [it for it in lst if it["g"] not in got]
        if keep:
            days[dstr] = keep
    for g, lst in got.items():
        seen = set()
        for it in lst:
            key = (it["g"], it["kind"], it["time"], it["title"])
            dkey = None
            # 日付はタイトル等に含まれないため、parse 時に付けた内部キーで管理する
            dkey = it.pop("_date", None)
            if dkey is None:
                continue
            if (dkey, key) in seen:
                continue
            seen.add((dkey, key))
            days.setdefault(dkey, []).append(it)
    # 保持範囲：前日〜翌月末
    horizon_start = (today - timedelta(days=1)).isoformat()
    days = {d: sorted(v, key=start_key) for d, v in sorted(days.items()) if d >= horizon_start}
    OUT.write_text(json.dumps({"updated": today.isoformat(), "days": days},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(len(v) for v in days.values())
    print(f"schedule: {total} items / {len(days)} days "
          f"(fetched: { {g: len(v) for g, v in got.items()} })")
    if not got:
        print("schedule: ALL groups failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
