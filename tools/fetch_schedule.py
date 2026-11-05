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


NOGI_CATE = {
    "birthday": "誕生日", "musical": "舞台/ミュージカル", "radio": "ラジオ",
    "tv": "テレビ", "web": "WEB", "live": "ライブ/イベント", "book": "書籍",
    "movie": "映画", "release": "CD/音楽配信/映像商品", "meetandgreet": "ミート&グリート",
}


def _jsonp(text: str):
    m = re.search(r"^[^(]*\((.*)\)\s*;?\s*$", (text or "").strip(), re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def _nogi_member_names() -> list[str]:
    d = _jsonp(fetch("https://www.nogizaka46.com/s/n46/api/list/member"))
    if not d:
        return []
    names = []
    for it in d.get("data", []):
        nm = name_norm(it.get("name", ""))
        if nm and nm != "乃木坂46":
            names.append(nm)
    return sorted(set(names), key=len, reverse=True)


def _nogi_split_title(title: str, cate: str, names: list[str]):
    """APIの title は末尾に出演メンバー名が連結されている。メンバーはタイトル
    由来のみで決める（arti_code は誤りがある実例を確認済みのため使わない）。"""
    narration = None
    m = re.search(r"\s*※ナレーション：(\S+)$", title)
    if m:
        narration = m.group(1)
        title = title[:m.start()]
    if cate == "birthday":
        nm = re.sub(r"\s+", "", title)
        return nm + " 誕生日", [nm], narration
    gm = re.search(r"([1-9])期生$", title)
    if gm:
        return title[:gm.start()], [gm.group(0)], narration
    out = []
    t = title
    while True:
        hit = None
        for nm in names:
            if t.endswith(nm):
                pre = t[:-len(nm)]
                if pre == "" or pre[-1] in "、」』）) 　・" or pre.endswith("公開"):
                    hit = (nm, pre)
                    break
        if not hit:
            break
        nm, pre = hit
        out.insert(0, nm)
        t = pre[:-1] if pre and pre[-1] == "、" else pre
        if pre == "":
            break
    return t.rstrip(" 　"), out, narration


def parse_nogizaka(ym: str) -> list[dict]:
    """公式JSON API（/s/n46/api/list/schedule、JSONP）から取得する。
    現在はWAFでスクリプト取得が遮断され [] を返す（前回分を保持）。
    遮断が解ければ自動でこの経路が生きる。"""
    d = _jsonp(fetch(f"https://www.nogizaka46.com/s/n46/api/list/schedule?dy={ym}"))
    if not d:
        return []
    names = _nogi_member_names()
    if not names:
        return []
    items = []
    for it in d.get("data", []):
        cate = it.get("cate", "")
        title, members, narration = _nogi_split_title(it.get("title", ""), cate, names)
        if narration and narration not in members:
            members.append(narration)
        start, end = it.get("start_time", ""), it.get("end_time", "")
        time_s = f"{start}〜{end}" if start and end else (f"{start}〜" if start else "")
        if cate == "birthday":
            ac = (it.get("arti_code") or [[""]])[0]
            code0 = ac[0] if ac else ""
            url = (f"https://www.nogizaka46.com/s/n46/artist/{code0}" if code0
                   else "https://www.nogizaka46.com/s/n46/media/list")
        else:
            url = f"https://www.nogizaka46.com/s/n46/media/detail/{it.get('code', '')}"
        items.append({
            "_date": (it.get("date", "")).replace("/", "-"),
            "g": "乃木坂46", "kind": NOGI_CATE.get(cate, cate), "time": time_s,
            "title": title, "members": members, "url": url,
        })
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
        n = parse_nogizaka(ym)
        if n:
            got.setdefault("乃木坂46", []).extend(n)
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
