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


# ---------------- 卒業生の個人サイト（グループ公式と同じ /s/<code>/ 基盤） ----------------

SOLO_CATE = {
    "tv": "テレビ", "radio": "ラジオ", "event": "イベント", "magazine": "雑誌",
    "stage": "舞台/ミュージカル", "web": "WEB", "movie": "映画", "other": "その他",
}

# (名前, 卒業グループ, origin, パス, バリアント)
SOLO_SITES = [
    ("松田好花", "日向坂46", "https://konokamatsuda-official.com", "/s/sf2", "list"),
    ("白石麻衣", "乃木坂46", "https://maishiraishi-official.com", "/s/ms", "daygroup"),
    ("西野七瀬", "乃木坂46", "https://nishinonanase.com", "/s/m04", "daygroup"),
    ("生田絵梨花", "乃木坂46", "https://erikaikuta.jp", "/s/m12", "daygroup"),
    ("齋藤飛鳥", "乃木坂46", "https://asukasaito.jp", "/s/m15", "daygroup"),
    ("山下美月", "乃木坂46", "https://mizukiyamashita.com", "/s/m16", "listdata"),
    # 2026-11-08 合同会社ポータル（n46llc-seedandflowerllc.com）から追加
    ("伊藤万理華", "乃木坂46", "https://itomarika.com", "/s/m03", "daygroup"),
    ("中元日芽香", "乃木坂46", "https://nakamotohimeka.com", "/s/m02", "daygroup"),
    ("桜井玲香", "乃木坂46", "https://reikasakurai.com", "/s/m08", "daygroup"),
    ("中田花奈", "乃木坂46", "https://kananakada.jp", "/s/ectp51", "daygroup"),
    ("与田祐希", "乃木坂46", "https://yuukiyoda.com", "/s/m03", "daygroup"),
    ("高山一実", "乃木坂46", "https://kazumitakayama.com", "/s/m11", "postlist"),
    ("樋口日奈", "乃木坂46", "https://higuchihina.jp", "/s/m14", "archivelist"),
    ("久保史緒里", "乃木坂46", "https://shiorikubo.com", "/s/m19", "postlist"),
    ("梅澤美波", "乃木坂46", "https://minamiumezawa.jp", "/s/m20", "daygroup"),
    ("佐々木久美", "日向坂46", "https://kumisasaki.com", "/s/sf1", "list"),
    ("丹生明里", "日向坂46", "https://akarinibu.com", "/s/an", "daygroup"),
    ("河田陽菜", "日向坂46", "https://hinakawata-official.com", "/s/sf3", "list"),
]


def fetch_status(url: str) -> tuple[int, str]:
    """HTTPステータス付き取得。失敗時は (0, "")。"""
    for _ in range(2):
        r = subprocess.run(
            ["curl", "-sL", "--max-time", "40", "-A", UA, "-w", "\n%{http_code}", url],
            capture_output=True, text=True)
        if r.returncode == 0 and r.stdout:
            body, sep, code = r.stdout.rpartition("\n")
            if sep and code.strip().isdigit():
                return int(code), body
    return 0, ""


def solo_kind(text: str) -> str:
    t = clean(text)
    return SOLO_CATE.get(t.lower(), t)


def solo_time(text: str) -> str:
    # 既存データの表記（〜）にそろえる
    t = clean(text).replace("～", "〜").replace("~", "〜")
    return re.sub(r"\s+", "", t)


def _solo_date(href: str, ym: str) -> str | None:
    """detail URL の year/mont/day 引数から日付を作る。対象月以外は None。"""
    m = re.search(r"year=(\d{4})&mont=(\d{1,2})&day=(\d{1,2})", href)
    if not m:
        return None
    dstr = f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return dstr if dstr.startswith(ym[:4] + "-" + ym[4:]) else None


def _solo_item(site, dstr: str, kind: str, time_s: str, title: str, href: str) -> dict:
    name, group, origin, _path, _variant = site
    return {"_date": dstr, "g": group, "kind": kind, "time": time_s,
            "title": title, "members": [name], "url": origin + href, "solo": True}


def _parse_daygroup(site, ym: str, h: str) -> list[dict]:
    """schedule_day_group バリアント（ms/m04/m12/m15）。
    list_card 内の .category（種別）/.date（時刻）/.title を拾う。"""
    items = []
    for card in re.findall(r'class="list_card">(.*?)</a>', h, re.S):
        href_m = re.search(r'href="([^"]+)"', card)
        cat = re.search(r'class="category">([^<]*)<', card)
        tim = re.search(r'class="date">([^<]*)<', card)
        tit = re.search(r'class="title">(.*?)</div>', card, re.S)
        if not (href_m and tit):
            continue
        href = unescape(href_m.group(1))
        dstr = _solo_date(href, ym)
        if not dstr:
            continue
        items.append(_solo_item(site, dstr,
                                solo_kind(cat.group(1)) if cat else "",
                                solo_time(tim.group(1)) if tim else "",
                                clean(tit.group(1)), href))
    return items


def _parse_listdata(site, ym: str, h: str) -> list[dict]:
    """list-data バリアント（m16）。<time>日付</time><span>種別</span><time>時刻</time>。"""
    items = []
    block = re.search(r'<ul class="list-data">(.*?)</ul>', h, re.S)
    if not block:
        return items
    for href, body in re.findall(r'<a href="([^"]*/media/detail/[^"]*)">(.*?)</a>',
                                  block.group(1), re.S):
        href = unescape(href)
        dstr = _solo_date(href, ym)
        if not dstr:
            continue
        times = re.findall(r"<time>([^<]*)</time>", body)
        cat = re.search(r"</time><span>([^<]*)</span>", body)
        tit = re.search(r"<p>(.*?)</p>", body, re.S)
        if not tit:
            continue
        items.append(_solo_item(site, dstr,
                                solo_kind(cat.group(1)) if cat else "",
                                solo_time(times[1]) if len(times) > 1 else "",
                                clean(tit.group(1)), href))
    return items


def _parse_postlist(site, ym: str, h: str) -> list[dict]:
    """postlist バリアント（m11/m19）。日付ごとの <ul class="postlist"> に
    .time（時刻）/.cate（種別）/p.text（タイトル）が入る。"""
    items = []
    seen = set()
    for block in re.findall(r'<ul class="postlist[^"]*">(.*?)</ul>', h, re.S):
        href_m = re.search(r'href="([^"]*/media/detail/[^"]*)"', block)
        tit = re.search(r'<p class="text">(.*?)</p>', block, re.S)
        if not (href_m and tit):
            continue
        href = unescape(href_m.group(1))
        if href in seen:
            continue
        seen.add(href)
        dstr = _solo_date(href, ym)
        if not dstr:
            continue
        tim = re.search(r'class="time">([^<]*)<', block)
        cat = re.search(r'class="cate">([^<]*)<', block)
        items.append(_solo_item(site, dstr,
                                solo_kind(cat.group(1)) if cat else "",
                                solo_time(tim.group(1)) if tim else "",
                                clean(tit.group(1)), href))
    return items


def _parse_archivelist(site, ym: str, h: str) -> list[dict]:
    """scheduleArchiveListItem バリアント（m14）。この型では .date が時刻、
    .cate が種別、.title がタイトルを保持する。"""
    items = []
    for block in re.findall(r'<li class="scheduleArchiveListItem">(.*?)</li>', h, re.S):
        href_m = re.search(r'href="([^"]*/media/detail/[^"]*)"', block)
        tit = re.search(r'class="title">(.*?)</h3>', block, re.S)
        if not (href_m and tit):
            continue
        href = unescape(href_m.group(1))
        dstr = _solo_date(href, ym)
        if not dstr:
            continue
        tim = re.search(r'class="date">([^<]*)<', block)
        cat = re.search(r'class="cate">([^<]*)<', block)
        items.append(_solo_item(site, dstr,
                                solo_kind(cat.group(1)) if cat else "",
                                solo_time(tim.group(1)) if tim else "",
                                clean(tit.group(1)), href))
    return items


def _parse_list(site, ym: str, h: str) -> list[dict]:
    """schedule_list バリアント（sf2）。 .category cate-* / .time / .title。"""
    items = []
    for href, body in re.findall(
            r'<a href="([^"]*/media/detail/[^"]*)">\s*<div class="schedule_wrap">(.*?)</a>',
            h, re.S):
        href = unescape(href)
        dstr = _solo_date(href, ym)
        if not dstr:
            continue
        cat = re.search(r'class="category[^"]*">([^<]*)<', body)
        tim = re.search(r'class="time">([^<]*)<', body)
        tit = re.search(r'class="title">(.*?)</div>', body, re.S)
        if not tit:
            continue
        items.append(_solo_item(site, dstr,
                                solo_kind(cat.group(1)) if cat else "",
                                solo_time(tim.group(1)) if tim else "",
                                clean(tit.group(1)), href))
    return items


_SOLO_PARSERS = {"daygroup": _parse_daygroup, "listdata": _parse_listdata,
                 "list": _parse_list, "postlist": _parse_postlist,
                 "archivelist": _parse_archivelist}


def _solo_marker_ok(variant: str, ym: str, h: str) -> bool:
    """要求した月のスケジュール一覧として描画されたかを示す特徴マーカー。
    （dy が無視されて別月が返るケースを失敗扱いにするための月一致チェックを含む）"""
    monthstr = re.escape(f"{ym[:4]}.{ym[4:]}")
    if variant == "daygroup":
        return ("list_group_wrap_width" in h
                and re.search(r'schedule_this_time[^>]*>\s*' + monthstr, h) is not None)
    if variant == "listdata":
        return ("is-schedule" in h
                and re.search(r'<span class="active">\s*' + monthstr + r"\s*</span>", h) is not None)
    if variant == "postlist":
        return re.search(r'schedule_this_time[^>]*>\s*' + monthstr, h) is not None
    if variant == "archivelist":
        return ("monthChangeBtnList" in h
                and re.search(r"<span>\s*" + monthstr + r"\s*</span>", h) is not None)
    return re.search(r'class="is-current">\s*' + monthstr + r"\s*<", h) is not None


def parse_solo(site, ym: str):
    """卒業生サイト1人×1月分。成功したら items（空月は0件）、失敗したら None。"""
    _name, _group, origin, path, variant = site
    code, h = fetch_status(f"{origin}{path}/media/list?dy={ym}")
    if code != 200 or not h or not _solo_marker_ok(variant, ym, h):
        return None
    return _SOLO_PARSERS[variant](site, ym, h)


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
    # 卒業生ソロ：人×月単位で成功/失敗を管理する（None は失敗＝前回分を保持）
    solo_got: dict[str, dict[str, list[dict]]] = {}
    for site in SOLO_SITES:
        for ym in months():
            items = parse_solo(site, ym)
            if items is not None:
                solo_got.setdefault(site[0], {})[ym] = items
    # 取得できたグループは当月・翌月分を入れ替え、失敗したグループは前回分を保持
    # （ソロのアイテムは g がグループ名でもここでは保持し、下のソロ用マージで扱う）
    days: dict[str, list[dict]] = {}
    for dstr, lst in prev.items():
        keep = [it for it in lst if it["g"] not in got or it.get("solo")]
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
    # 卒業生ソロのマージ：取得成功した人×月だけ、その人の既存アイテムを置換する
    for site in SOLO_SITES:
        name = site[0]
        per_month = solo_got.get(name)
        if not per_month:
            continue
        prefixes = {f"{ym[:4]}-{ym[4:]}" for ym in per_month}
        for dstr in list(days):
            rest = [it for it in days[dstr]
                    if not (it.get("solo") and it.get("members") == [name]
                            and dstr[:7] in prefixes)]
            if rest:
                days[dstr] = rest
            else:
                del days[dstr]
        seen = set()
        for ym, lst in per_month.items():
            for it in lst:
                dkey = it.pop("_date", None)
                if dkey is None:
                    continue
                key = (it["kind"], it["time"], it["title"])
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
    solo_counts = {n: {ym: len(v) for ym, v in sorted(pm.items())}
                   for n, pm in solo_got.items()}
    print(f"schedule: {total} items / {len(days)} days "
          f"(fetched: { {g: len(v) for g, v in got.items()} }, solo: {solo_counts})")
    if not got:
        print("schedule: ALL groups failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
