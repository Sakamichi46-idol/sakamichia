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
    # 加藤史帆：サイト側の /s/sk/media/list が Not Found を返すため現在は0件。
    # 公式側で復活すれば自動で流れ込むよう、取得対象には登録しておく
    ("加藤史帆", "日向坂46", "https://shihokato.com", "/s/sk", "list"),
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


# ---------------- その他の卒業生サイト（サイトごとに形式が違う） ----------------

# (名前, 卒業グループ, kind, base, opt)
SOLO_WEB = [
    ("中村麗乃", "乃木坂46", "officialfc", "https://nakamurareno.officialfc.jp", ""),
    ("山崎怜奈", "乃木坂46", "officialfc", "https://yamazakirena.jp", ""),
    ("秋元真夏", "乃木坂46", "officialfc", "https://www.akimotomanatsu-fc.jp", ""),
    ("北野日奈子", "乃木坂46", "officialfc", "https://www.kitanohinako-fc.jp", ""),
    ("阪口珠美", "乃木坂46", "officialfc", "https://tamamisakaguchi.jp", ""),
    ("佐々木美玲", "日向坂46", "officialfc", "https://mireisasaki.officialfc.jp", ""),
    ("渡邉美穂", "日向坂46", "officialfc", "https://mihowatanabe.jp", ""),
    ("堀未央奈", "乃木坂46", "hori", "https://hori-miona.com", ""),
    ("佐々木琴子", "乃木坂46", "kotoko", "https://sasakikotoko.com", ""),
    ("相楽伊織", "乃木坂46", "sagara", "https://sagara-iori.jp", ""),
    ("菅井友香", "櫻坂46", "topcoat", "https://topcoat.co.jp", ""),
    ("齋藤冬優花", "櫻坂46", "infinity", "https://infinity-dance.jp", "saito-fuyuka"),
    ("長濱ねる", "欅坂46", "flamme", "https://www.flamme.co.jp", "5941"),
    ("小林由依", "櫻坂46", "sony", "https://www.sonymusic.co.jp", "YuiKobayashi,yousti"),
]

HORI_CATE = {"TV": "テレビ", "Web": "WEB", "Radio": "ラジオ", "Magazine": "雑誌",
             "Event": "イベント", "Stage": "舞台/ミュージカル", "Movie": "映画",
             "Live": "ライブ", "Other": "その他"}
FLAMME_CATE = {2: "映画", 3: "テレビ", 4: "WEB", 5: "CM", 6: "舞台/ミュージカル",
               7: "ラジオ", 8: "雑誌", 9: "WEB", 10: "その他", 13: "その他"}
SONY_CATE = {"tv": "テレビ", "radio": "ラジオ", "magazine": "雑誌", "web": "WEB"}
MONTH_EN = ["", "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
            "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]

_WEB_CACHE: dict = {}


def _web_item(name, group, dstr, kind, time_s, title, url):
    return {"_date": dstr, "g": group, "kind": kind, "time": time_s,
            "title": title, "members": [name], "url": url, "solo": True}


def _strip_tags(s: str) -> str:
    return clean(re.sub(r"<[^>]+>", "", unescape(s or "")))


def _infer_md_date(month: int, day: int):
    """年が無い月日だけの予定に、今日を基準に最も自然な年を当てる。"""
    today = date.today()
    try:
        cand = date(today.year, month, day)
    except ValueError:
        return None
    if cand < today - timedelta(days=45):
        cand = date(today.year + 1, month, day)
    elif cand > today + timedelta(days=200):
        cand = date(today.year - 1, month, day)
    return cand


def _fetch_officialfc(entry, ym: str):
    """officialfc.jp 系FCの月別カレンダー（/calendars/<年>/<月>）。"""
    name, group, _kind, base, _opt = entry
    y, m = ym[:4], int(ym[4:])
    code, h = fetch_status(f"{base}/calendars/{y}/{m}")
    if code != 200 or "SCHEDULE" not in h or "/calendars/" not in h:
        return None
    items = []
    for href, block in re.findall(
            r'<a href="(/schedules/[0-9a-f-]{36})">(.*?)</a>', h, re.S):
        dm = re.search(r">(\d{1,2})/(\d{1,2})</p>", block)
        if not dm or int(dm.group(1)) != m:
            continue
        cat = re.search(r"bg-themeSecondary[^>]*>([^<]+)</p>", block)
        tit = re.search(r"min-w-0[^>]*>(.*?)</p>", block, re.S)
        if not tit:
            continue
        dstr = f"{y}-{int(dm.group(1)):02d}-{int(dm.group(2)):02d}"
        items.append(_web_item(name, group, dstr,
                               solo_kind(cat.group(1)) if cat else "",
                               "", _strip_tags(tit.group(1)), base + href))
    return items


def _fetch_sagara(entry, ym: str):
    """相楽伊織サイトの月別カレンダー（/schedule?month=YYYY-MM）。
    日セルにリンクや段落が増えた場合だけ予定として拾う（空月は0件）。"""
    name, group, _kind, base, _opt = entry
    y, m = int(ym[:4]), int(ym[4:])
    code, h = fetch_status(f"{base}/schedule?month={y}-{m:02d}")
    if code != 200 or f"{MONTH_EN[m]} {y}" not in h:
        return None
    items = []
    for cell in re.findall(r'<li class="item[^"]*">(.*?)</li>', h, re.S):
        dm = re.search(r'class="day">(\d+)</div>', cell)
        if not dm:
            continue
        rest = cell[dm.end():]
        if "<a" not in rest and "<p" not in rest:
            continue
        title = _strip_tags(rest)
        if not title:
            continue
        href = re.search(r'href="([^"]+)"', rest)
        if href and href.group(1).startswith("/"):
            url = base + href.group(1)
        elif href:
            url = href.group(1)
        else:
            url = f"{base}/schedule?month={y}-{m:02d}"
        dstr = f"{y}-{m:02d}-{int(dm.group(1)):02d}"
        items.append(_web_item(name, group, dstr, "", "", title, url))
    return items


def _fetch_hori_all(entry):
    """堀未央奈サイトの予定一覧（/schedule/list、月日＋年なし）。"""
    name, group, _kind, base, _opt = entry
    code, h = fetch_status(f"{base}/schedule/list")
    if code != 200 or "list--schedule" not in h:
        return None
    items = []
    for block in re.findall(r'<li class="category--\d+[^"]*">(.*?)</li>', h, re.S):
        mm = re.search(r'class="m">(\d{1,2})</span>', block)
        dd = re.search(r'class="d">(\d{1,2})</span>', block)
        tit = re.search(r'class="tit">(.*?)</p>', block, re.S)
        if not (mm and dd and tit):
            continue
        cat = re.search(r'class="category">([^<]*)</p>', block)
        cat_t = clean(cat.group(1)) if cat else ""
        href = re.search(r'href="(/schedule/detail/\d+)"', block)
        items.append({"md": (int(mm.group(1)), int(dd.group(1))),
                      "g": group, "kind": HORI_CATE.get(cat_t, cat_t),
                      "time": "", "title": _strip_tags(tit.group(1)),
                      "members": [name],
                      "url": base + (href.group(1) if href else "/schedule/list"),
                      "solo": True})
    return items


def _fetch_kotoko_all(entry):
    """佐々木琴子サイトのトップに載る直近の予定（日付に年あり）。"""
    name, group, _kind, base, _opt = entry
    code, h = fetch_status(base + "/")
    if code != 200 or "anchor-top-schedule" not in h:
        return None
    items = []
    pat = (r'<a href="(/schedule/[A-Za-z0-9_-]+)" external '
           r'class="flex items-start[^"]*">(.*?)</a>')
    for href, block in re.findall(pat, h, re.S):
        dm = re.search(r">(\d{1,2})\.(\d{1,2})</div>", block)
        tit = re.search(r"line-clamp-2 break-words\">([^<]+)<", block)
        if not (dm and tit):
            continue
        cat = re.search(r"truncate text-center leading-snug\">([^<]+)<", block)
        ym2 = re.search(r"(?:MON|TUE|WED|THU|FRI|SAT|SUN)\s*(\d{4})", block)
        it = {"g": group, "kind": clean(cat.group(1)) if cat else "",
              "time": "", "title": _strip_tags(tit.group(1)),
              "members": [name], "url": base + href, "solo": True}
        if ym2:
            it["_date"] = (f"{int(ym2.group(1)):04d}-{int(dm.group(1)):02d}"
                           f"-{int(dm.group(2)):02d}")
        else:
            it["md"] = (int(dm.group(1)), int(dm.group(2)))
        items.append(it)
    return items


def _fetch_topcoat_all(entry):
    """トップコートの予定一覧（/contents/schedule）から本人の分だけ。
    日付と時刻は本文テキスト（○月○日＋時刻範囲）から読む。"""
    name, group, _kind, base, _opt = entry
    code, h = fetch_status(f"{base}/contents/schedule")
    if code != 200 or "contents-list-item" not in h:
        return None
    items = []
    for block in re.findall(r'<li class="contents-list-item">(.*?)</li>', h, re.S):
        if f'contents-list-artist">{name}' not in block:
            continue
        tit = re.search(
            r'<h3 class="contents-list-title title hidden-xs">(.*?)</h3>',
            block, re.S)
        if not tit:
            continue
        body = re.search(r'<div class="body index-\d+">(.*?)</div>', block, re.S)
        btext = _strip_tags(body.group(1)) if body else ""
        dm = re.search(r"(\d{1,2})月(\d{1,2})日", btext)
        if not dm:
            continue
        tm = re.search(r"(\d{1,2}:\d{2})\s*[〜~]\s*(\d{1,2}:\d{2})", btext)
        items.append({"md": (int(dm.group(1)), int(dm.group(2))),
                      "g": group, "kind": "",
                      "time": solo_time(f"{tm.group(1)}〜{tm.group(2)}") if tm else "",
                      "title": _strip_tags(tit.group(1)), "members": [name],
                      "url": f"{base}/contents/schedule", "solo": True})
    return items


def _fetch_infinity_all(entry):
    """INFINITY の予定一覧（/schedule/?artist=<slug>）。本人の分だけ拾う。"""
    name, group, _kind, base, opt = entry
    code, h = fetch_status(f"{base}/schedule/?artist={opt}")
    if code != 200 or 'id="content" class="schedule"' not in h:
        return None
    items = []
    for block in re.findall(r'<li class="item[^"]*">(.*?)</li>', h, re.S):
        if f"/artist/{opt}/" not in block:
            continue
        dm = re.search(r'class="date">(\d{4})\.(\d{1,2})\.(\d{1,2})<', block)
        tit = re.search(r'<p class="txt">([^<]+)</p>', block)
        if not (dm and tit):
            continue
        dstr = (f"{int(dm.group(1)):04d}-{int(dm.group(2)):02d}"
                f"-{int(dm.group(3)):02d}")
        items.append(_web_item(name, group, dstr, "", "",
                               _strip_tags(tit.group(1)),
                               f"{base}/schedule/?artist={opt}"))
    return items


def _fetch_flamme_all(entry):
    """FLaMme の WordPress REST（/wp-json/wp/v2/schedule）。
    本人名で検索し、acf.sched_name（opt=人物ID）で照合する。"""
    from urllib.parse import quote
    name, group, _kind, base, opt = entry
    code, h = fetch_status(
        f"{base}/wp-json/wp/v2/schedule?per_page=100&search={quote(name)}")
    if code != 200:
        return None
    try:
        records = json.loads(h)
    except Exception:
        return None
    if not isinstance(records, list):
        return None
    items = []
    for rec in records:
        acf = rec.get("acf") or {}
        if str(acf.get("sched_name")) != opt:
            continue
        title = _strip_tags((rec.get("title") or {}).get("rendered", ""))
        title = re.sub(r"^[\s\U0001F000-\U0001FAFF☀-➿️]+", "", title)
        if name in title and "|" in title:
            title = title.split("|", 1)[1].strip()
        if not title:
            continue
        kind = FLAMME_CATE.get(acf.get("sched_category"), "")
        special = acf.get("sched_special_date_format") or ""
        sm = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}:\d{2})?", special)
        for dayent in acf.get("sched_specific_day") or []:
            dv = str((dayent or {}).get("sched_specific_day_day") or "")
            if not re.fullmatch(r"\d{8}", dv):
                continue
            dstr = f"{dv[:4]}-{dv[4:6]}-{dv[6:]}"
            time_s = ""
            if sm and (f"{int(sm.group(1)):04d}-{int(sm.group(2)):02d}"
                       f"-{int(sm.group(3)):02d}") == dstr:
                time_s = sm.group(4) or ""
            items.append(_web_item(name, group, dstr, kind, time_s, title,
                                   rec.get("link") or base))
    return items


def _fetch_sony_all(entry):
    """小林由依：Sony Music のアーティストJSON（media と live の2フィード、
    小林由依名義と yousti 名義の両方）を予定に変換する。"""
    name, group, _kind, base, opt = entry
    sched_url = "https://www.yuikobayashi-yousti.jp/kobayashi_yui/schedule/"
    items = []
    for code_name in opt.split(","):
        for feed in ("media", "live"):
            code, h = fetch_status(
                f"{base}/json/v2/artist/{code_name}/{feed}/start/0/count/100")
            if code != 200:
                return None
            m = re.match(r"\s*callback\((.*)\)\s*;?\s*$", h, re.S)
            try:
                data = json.loads(m.group(1) if m else h)
            except Exception:
                return None
            raw = data.get("items")
            if feed == "media":
                if not isinstance(raw, dict):
                    continue
                for cat, vals in raw.items():
                    for v in vals or []:
                        d = (v.get("date") or "").replace(".", "-")
                        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
                            continue
                        st, et = v.get("startTime") or "", v.get("endTime") or ""
                        time_s = solo_time(f"{st}〜{et}") if st and et else st
                        title = clean(v.get("program") or "")
                        media = clean(v.get("media") or "")
                        if media and media not in title:
                            title = f"{title}（{media}）" if title else media
                        if not title:
                            continue
                        items.append(_web_item(name, group, d,
                                               SONY_CATE.get(cat, ""), time_s,
                                               title, sched_url))
            else:
                if not isinstance(raw, list):
                    continue
                for tour in raw:
                    for li in tour.get("liveItem") or []:
                        d = (li.get("date") or "").replace(".", "-")
                        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
                            continue
                        title = clean(li.get("tourName") or "")
                        place = clean(li.get("place") or "")
                        if place and place not in title:
                            title = f"{title}（{place}）" if title else place
                        if not title:
                            continue
                        link = li.get("link") or ""
                        url = ("https://www.sonymusic.co.jp" + link
                               if link.startswith("/") else sched_url)
                        items.append(_web_item(name, group, d, "イベント",
                                               clean(li.get("start") or ""),
                                               title, url))
    return items


def parse_solo_web(entry, ym: str):
    """SOLO_WEB の1人×1月分。成功したら items、失敗したら None。
    一覧型のサイトは全件を1回だけ取得してキャッシュし、月で絞る。"""
    _name, _group, kind, base, opt = entry
    if kind == "officialfc":
        return _fetch_officialfc(entry, ym)
    if kind == "sagara":
        return _fetch_sagara(entry, ym)
    key = (kind, base, opt)
    if key not in _WEB_CACHE:
        fn = {"hori": _fetch_hori_all, "kotoko": _fetch_kotoko_all,
              "topcoat": _fetch_topcoat_all, "infinity": _fetch_infinity_all,
              "flamme": _fetch_flamme_all, "sony": _fetch_sony_all}[kind]
        _WEB_CACHE[key] = fn(entry)
    all_items = _WEB_CACHE[key]
    if all_items is None:
        return None
    prefix = f"{ym[:4]}-{ym[4:]}"
    out = []
    for it in all_items:
        d = it.get("_date")
        if d is None:
            md = it.get("md")
            if not md:
                continue
            cand = _infer_md_date(md[0], md[1])
            if cand is None:
                continue
            d = cand.isoformat()
        if d.startswith(prefix):
            out.append({k: v for k, v in it.items() if k != "md"} | {"_date": d})
    return out


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
    for entry in SOLO_WEB:
        for ym in months():
            items = parse_solo_web(entry, ym)
            if items is not None:
                solo_got.setdefault(entry[0], {})[ym] = items
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
    for name in [s[0] for s in SOLO_SITES] + [s[0] for s in SOLO_WEB]:
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
