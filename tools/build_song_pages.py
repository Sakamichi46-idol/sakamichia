#!/usr/bin/env python3
"""楽曲個別ページ（/songs/<id>/）と楽曲別OGP画像を生成する。

楽曲図鑑（assets/js/songs.js）の詳細ダイアログと同じ内容を、検索エンジンと
共有（OGP）に効く静的HTMLとして書き出す。ジャケット画像は
tools/fetch_jackets.py が集めた data/jackets.json（初収録リリース）を使う。
daily ワークフローで再生成する。

入力: data/songs.json, formations.json, members.json, member-photos.json,
      song-live.json, jackets.json
出力: songs/<id>/index.html（全曲分）、assets/ogp/songs/<id>.jpg、
      sitemap.xml の楽曲ページ区間（マーカーの間を差し替え）
"""
import html
import io
import json
import os
import re
import urllib.parse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BASE_URL = "https://sakamichia.pages.dev"
GCOL = {"乃木坂46": "#7e57c2", "櫻坂46": "#e77a9b", "日向坂46": "#5aa9d6",
        "欅坂46": "#5eba53", "けやき坂46": "#a4c639", "坂道AKB": "#d24a43",
        "坂道選抜": "#2f9e8f", "その他": "#607d8b"}
ERA_RANK = {"けやき坂46": 1, "欅坂46": 2, "櫻坂46": 3, "日向坂46": 3, "乃木坂46": 0}
FAM_ORDER = ["乃木坂46", "櫻坂46", "日向坂46"]
FAMILY = {"乃木坂46": "乃木坂46", "櫻坂46": "櫻坂46", "欅坂46": "櫻坂46",
          "日向坂46": "日向坂46", "けやき坂46": "日向坂46"}
SUR3 = ["一ノ瀬", "五百城", "正源司", "向井地"]
SUR1 = ["林", "柏", "関", "岸", "堀", "潮"]


def load(name):
    with open(os.path.join(ROOT, "data", name), encoding="utf-8") as f:
        return json.load(f)


def esc(s):
    return html.escape(str(s), quote=True)


def rel_label(code):
    return re.sub(r"^(?:HK|K|S)(?=\d|Digital|BestAL|Unreleased)", "", str(code or ""))


def clean_release_name(name):
    n = str(name or "")
    n = re.sub(r"\s*\((?:Special Edition|Complete Edition|Type [A-E]|劇場盤)\)", "", n)
    n = re.sub(r"\s*-\s*(?:EP|Single)$", "", n)
    return n.strip()


def split_name(name):
    for s in SUR3:
        if name.startswith(s) and len(name) > len(s):
            return s, name[len(s):]
    if name and name[0] in SUR1 and len(name) > 2:
        return name[0], name[1:]
    if len(name) >= 3:
        return name[:2], name[2:]
    return name, ""


def main():
    songs = load("songs.json")
    if isinstance(songs, dict):
        songs = songs["songs"]
    formations = load("formations.json")
    members = load("members.json")
    photos = load("member-photos.json")
    song_live = load("song-live.json")
    try:
        jackets = load("jackets.json")
    except FileNotFoundError:
        jackets = {}

    memb = {m["name"]: m for m in members}
    slug_of = {name: f.replace(".jpg", "").replace("_", "-")
               for name, f in photos.items()}

    def memb_family(m):
        gs = m.get("groups") or [m.get("group")]
        lg, br = m.get("group"), -1
        for g in gs:
            r = ERA_RANK.get(g, 0)
            if r > br:
                br, lg = r, g
        return FAMILY.get(lg, lg)

    def cmp_key(name):
        m = memb.get(name)
        if not m:
            return (3, 99, name)  # 名簿に無い参加者は後ろに名前順
        fam = memb_family(m)
        fi = FAM_ORDER.index(fam) if fam in FAM_ORDER else 2
        return (fi, m.get("gen") or 99, m.get("reading") or name)

    def sorted_parts(names):
        return sorted(names, key=cmp_key)

    def name_link(name):
        if name in slug_of:
            return f'<a href="../../members/{slug_of[name]}/">{esc(name)}</a>'
        return esc(name)

    def participants(s):
        f = formations.get(f"{s['group']}|{s['title']}") or {}
        if f.get("rows"):
            return list(dict.fromkeys(x for row in f["rows"] for x in row))
        if f.get("vocal"):
            return list(f["vocal"])
        if f.get("mv"):
            return list(f["mv"])
        return []

    def genre_rank(s):
        g = s.get("genre") or ""
        return 0 if (re.match(r"^A[:：]", g) or "表題曲" in g or "リード曲" in g) else 1

    # 同じリリース（グループ・コード・発売日。外部曲は収録作品名）の曲リスト
    rel_groups = {}
    for i, s in enumerate(songs):
        if s["group"] == "その他":
            key = ("その他", s.get("work") or s.get("title"))
        else:
            key = (s["group"], s.get("release") or "", s.get("date") or "")
        rel_groups.setdefault(key, []).append(i)
    for key, idxs in rel_groups.items():
        idxs.sort(key=lambda i: (songs[i].get("ord") if songs[i].get("ord") is not None else 999,
                                 genre_rank(songs[i]), i))

    try:
        from PIL import Image, ImageDraw, ImageFont
        have_pil = True
    except ImportError:
        have_pil = False
        print("WARN: Pillow が無いため OGP 画像は生成しません")

    ogp_changed = 0
    if have_pil:
        FB = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
        FR = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
        if not os.path.exists(FB):
            import subprocess
            try:
                out = subprocess.run(["fc-list", ":style=Bold", "family=Noto Sans CJK JP", "file"],
                                     capture_output=True, text=True).stdout.splitlines()
                if out:
                    FB = out[0].split(":")[0]
                out = subprocess.run(["fc-list", ":style=Regular", "family=Noto Sans CJK JP", "file"],
                                     capture_output=True, text=True).stdout.splitlines()
                if out:
                    FR = out[0].split(":")[0]
            except Exception:
                pass
        INK = (43, 36, 48)
        GRAY = (110, 102, 118)
        NC, SC, HC = (126, 87, 194), (231, 122, 155), (90, 169, 214)
        PALE = [(244, 239, 252), (253, 240, 244), (237, 246, 251)]

        def wrap_title(d, text, font, maxw):
            lines, cur = [], ""
            for ch in text:
                if d.textlength(cur + ch, font=font) > maxw and cur:
                    lines.append(cur)
                    cur = ch
                else:
                    cur += ch
            if cur:
                lines.append(cur)
            return lines

        def make_ogp(s, jacket_file, sub1, sub2):
            W, H = 1200, 630
            img = Image.new("RGB", (W, H), (255, 255, 255))
            px = img.load()
            stops = [(0.0, PALE[0]), (0.52, PALE[1]), (1.0, PALE[2])]
            for x in range(W):
                t = x / (W - 1)
                col = PALE[-1]
                for i2 in range(len(stops) - 1):
                    if stops[i2][0] <= t <= stops[i2 + 1][0]:
                        a, b = stops[i2], stops[i2 + 1]
                        u = (t - a[0]) / (b[0] - a[0])
                        col = tuple(int(a[1][k] + (b[1][k] - a[1][k]) * u) for k in range(3))
                for y in range(H):
                    px[x, y] = col
            d = ImageDraw.Draw(img)
            text_w = W - 64 * 2
            if jacket_file:
                js = Image.open(jacket_file).convert("RGB")
                js = js.resize((H, H))
                img.paste(js, (W - H, 0))
                d = ImageDraw.Draw(img)
                text_w = W - H - 64 - 40
            for i2, c in enumerate([NC, SC, HC]):
                d.ellipse([64 + i2 * 30, 56, 64 + i2 * 30 + 18, 74], fill=c)
            d.text((160, 46), "サカミチア", font=ImageFont.truetype(FB, 40), fill=INK)
            size = 84
            while size > 40:
                fnt = ImageFont.truetype(FB, size)
                lines = wrap_title(d, s["title"], fnt, text_w)
                if len(lines) <= 2:
                    break
                size -= 8
            y = 190
            for ln in lines:
                d.text((64, y), ln, font=fnt, fill=INK)
                y += int(size * 1.22)
            def fit_font(text, size, min_size=22):
                while size > min_size:
                    fnt2 = ImageFont.truetype(FR, size)
                    if d.textlength(text, font=fnt2) <= text_w:
                        return fnt2
                    size -= 2
                return ImageFont.truetype(FR, min_size)

            d.text((66, y + 26), sub1, font=fit_font(sub1, 34), fill=INK)
            if sub2:
                d.text((66, y + 82), sub2, font=fit_font(sub2, 29), fill=GRAY)
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=82)
            return buf.getvalue()

    pages = 0
    for i, s in enumerate(songs):
        sid = str(s["id"]).lower()
        grp = s["group"]
        f = formations.get(f"{grp}|{s['title']}") or {}
        jack = jackets.get(f"{s.get('release') or ''}|{s.get('date') or ''}") or {}
        jack_img = jack.get("img") or ""
        jack_file = os.path.join(ROOT, jack_img) if jack_img else None
        if jack_file and not os.path.exists(jack_file):
            jack_file, jack_img = None, ""
        rel_name = clean_release_name(jack.get("name")) if jack else ""
        live_e = (song_live.get("songs") or {}).get(s["title"]) or {}
        live_n = live_e.get("n") or 0

        title = f"{s['title']}（{grp}）のフォーメーション・参加メンバー・ライブ披露履歴 | サカミチア"
        url = f"{BASE_URL}/songs/{sid}/"
        ogp_url = f"{BASE_URL}/assets/ogp/songs/{sid}.jpg"
        info_bits = []
        if s.get("date"):
            info_bits.append(f"{s['date']}発売")
        if s.get("type"):
            info_bits.append(s["type"])
        if s.get("center"):
            info_bits.append(f"センター：{s['center']}")
        desc = (f"{s['title']}（{grp}）の個別ページ。" + "・".join(info_bits) +
                "。フォーメーション、参加メンバー、ライブ披露履歴。非公式ファンサイト「サカミチア」。")

        # 基本情報
        info = [f'<p><span class="chip g-{esc(grp)}">{esc(grp)}</span></p>']
        meta_rows = []
        if s.get("date"):
            meta_rows.append(f"発売日：<b>{esc(s['date'])}</b>")
        if grp == "その他":
            if s.get("artist"):
                meta_rows.append(f"アーティスト：<b>{esc(s['artist'])}</b>" +
                                 (' <span class="tag">卒業後の参加・出演</span>' if s.get("afterGrad") else ""))
            if s.get("work"):
                meta_rows.append(f"収録：{esc(s['work'])}")
        elif s.get("release"):
            rn = rel_name or rel_label(s["release"])
            meta_rows.append(f"収録：<b>{esc(rn)}</b>（{esc(rel_label(s['release']))}）" if rel_name
                             else f"収録：<b>{esc(rn)}</b>")
        if s.get("type"):
            meta_rows.append(f"種別：{esc(s['type'])}")
        if s.get("center"):
            ctr = "・".join(name_link(n) for n in s["center"].split("・"))
            meta_rows.append(f"センター：<b>{ctr}</b>")
        if s.get("writers"):
            meta_rows.append(f"作曲：{esc('、'.join(s['writers']))}")
        if s.get("arrangers"):
            meta_rows.append(f"編曲：{esc('、'.join(s['arrangers']))}")
        if live_n:
            meta_rows.append(f"ライブ披露：<b>{live_n}件</b>")
        info.append("<p>" + "<br>".join(meta_rows) + "</p>")
        if s.get("mv"):
            info.append(f'<p><a class="btn" href="{esc(s["mv"])}" target="_blank" rel="noopener">'
                        f'公式MV{"（Short Ver.）" if s.get("mvKind") == "short" else ""}を見る（YouTube）</a></p>')
        if s.get("note"):
            info.append(f'<p style="color:var(--muted);font-size:13px">{esc(s["note"])}</p>')

        hero_img = ""
        if jack_img:
            hero_img = (f'<div class="sg-jacket"><img src="../../{esc(jack_img)}" '
                        f'alt="{esc(rel_name or s["title"])}のジャケット">'
                        f'<p class="mb-cap">初収録リリース「{esc(rel_name)}」のジャケット</p></div>')

        # フォーメーション／歌唱メンバー
        body = []
        song_json = None
        if f.get("external"):
            if f.get("vocal"):
                label = "参加メンバー" if s.get("type") == "外部作品収録" else "歌唱参加メンバー（坂道側）"
                alln = sorted_parts(f["vocal"])
                body.append(f'<h4 style="margin:16px 0 4px">{label}（{len(alln)}名）</h4>'
                            f'<p style="line-height:2">{"、".join(name_link(n) for n in alln)}</p>')
            if f.get("mv"):
                alln = sorted_parts(f["mv"])
                body.append(f'<h4 style="margin:16px 0 4px">MV出演メンバー（{len(alln)}名）</h4>'
                            f'<p style="line-height:2">{"、".join(name_link(n) for n in alln)}</p>')
        elif f.get("rows"):
            rows = f["rows"]
            last = len(rows) - 1
            tiles_rows = []
            for ri, row in enumerate(rows):
                n = len(row)
                ctr_idx = []
                if ri == last:
                    ctr_idx = [n // 2] if n % 2 == 1 else [n // 2 - 1, n // 2]
                tiles = []
                for ci, name in enumerate(row):
                    fam, giv = split_name(name)
                    nm = (f'<span class="fq-name"><span class="fq-fam">{esc(fam)}</span>'
                          + (f'<span class="fq-giv{" long" if len(giv) >= 4 else ""}">{esc(giv)}</span>' if giv else "")
                          + '</span>')
                    if name in photos:
                        ph = f'<img loading="lazy" src="../../assets/member-photos/{esc(photos[name])}" alt="">'
                    else:
                        ph = '<span class="sg-nophoto"></span>'
                    tiles.append(f'<div class="fq-tile{" ctr" if ci in ctr_idx else ""}">{ph}{nm}</div>')
                tiles_rows.append(f'<div class="fq-row" style="--maxn:{n}">' + "".join(tiles) + "</div>")
            body.append('<h4 style="margin:16px 0 4px">フォーメーション</h4>'
                        '<p style="color:var(--muted);font-size:12px;margin:0 0 6px">上が後列、下が前列です。'
                        f'色付きがセンター。{"（公式発表に基づく）" if f.get("official") else "（参考データに基づく）"}</p>'
                        f'<div class="fq-board{" wide" if max(len(r) for r in rows) >= 10 else ""}">'
                        + "".join(tiles_rows) + "</div>")
            alln = sorted_parts(participants(s))
            body.append(f'<h4 style="margin:16px 0 4px">参加メンバー（{len(alln)}名）</h4>'
                        f'<p style="line-height:2">{"、".join(name_link(n) for n in alln)}</p>')
            body.append('<p style="margin-top:14px"><button type="button" id="sgEditFormation">'
                        'このフォーメーションを編集する</button></p>')
            song_json = {"title": s["title"],
                         "rows": [len(r) for r in reversed(rows)],
                         "positions": [x for r in reversed(rows) for x in r]}
            if f.get("vocal"):
                alln = sorted_parts(f["vocal"])
                body.append(f'<h4 style="margin:16px 0 4px">歌唱メンバー（{len(alln)}名）</h4>'
                            f'<p style="line-height:2">{"、".join(name_link(n) for n in alln)}</p>')
        elif f.get("vocal"):
            alln = sorted_parts(f["vocal"])
            body.append(f'<h4 style="margin:16px 0 4px">歌唱メンバー（{len(alln)}名）</h4>'
                        f'<p style="line-height:2">{"、".join(name_link(n) for n in alln)}</p>')
        elif f.get("note"):
            body.append(f'<h4 style="margin:16px 0 4px">歌唱メンバー</h4>'
                        f'<p style="line-height:2">{esc(f["note"])}</p>')
        else:
            body.append('<p style="color:var(--muted)">フォーメーション情報は未登録です。</p>')

        # ライブ披露履歴
        live_html = ""
        ids = live_e.get("ids") or []
        if ids:
            shows = song_live.get("shows") or {}
            rows = []
            for lid in ids[:20]:
                sh = shows.get(lid)
                if not sh:
                    continue
                rows.append(f'<div style="padding:7px 0;border-bottom:1px solid var(--line)">'
                            f'<a href="../../live/?show={urllib.parse.quote(lid)}"><b>{esc(sh[1])}</b></a><br>'
                            f'<span style="color:var(--muted);font-size:13px">{esc(sh[0])}'
                            f'{(" ・ " + esc(sh[2])) if len(sh) > 2 and sh[2] else ""}</span></div>')
            live_html = (f'<h4 style="margin:18px 0 4px">この曲が披露されたライブ（{live_n}件）</h4>'
                         + "".join(rows)
                         + (f'<p style="color:var(--muted);font-size:13px;margin:6px 0 0">'
                            f'新しい順に20件まで表示しています（全{live_n}件）。</p>' if live_n > 20 else ""))

        # 同じリリースの曲＋前後の曲
        if grp == "その他":
            key = ("その他", s.get("work") or s.get("title"))
        else:
            key = (grp, s.get("release") or "", s.get("date") or "")
        sib = rel_groups.get(key, [])
        sib_html, nav_html = "", ""
        if len(sib) > 1:
            items = []
            for j in sib:
                sj = songs[j]
                if j == i:
                    items.append(f"<b>{esc(sj['title'])}</b>")
                else:
                    items.append(f'<a href="../{str(sj["id"]).lower()}/">{esc(sj["title"])}</a>')
            sib_html = (f'<h4 style="margin:18px 0 4px">同じリリースの曲</h4>'
                        f'<p style="line-height:2">{"、".join(items)}</p>')
            pos = sib.index(i)
            nav = []
            if pos > 0:
                pj = songs[sib[pos - 1]]
                nav.append(f'<a href="../{str(pj["id"]).lower()}/">← 前の曲「{esc(pj["title"])}」</a>')
            if pos < len(sib) - 1:
                nj = songs[sib[pos + 1]]
                nav.append(f'<a href="../{str(nj["id"]).lower()}/">次の曲「{esc(nj["title"])}」 →</a>')
            if nav:
                nav_html = ('<p style="display:flex;justify-content:space-between;gap:10px;'
                            'flex-wrap:wrap;margin-top:22px">' + "".join(nav) + "</p>")

        page = f"""<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)}</title><meta name="description" content="{esc(desc)}"><link rel="icon" href="../../favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="../../apple-touch-icon.png"><meta name="theme-color" content="#faf9fb"><meta property="og:type" content="music.song"><meta property="og:site_name" content="サカミチア"><meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}"><meta property="og:url" content="{url}"><link rel="canonical" href="{url}"><meta property="og:image" content="{ogp_url}"><meta name="twitter:card" content="summary_large_image"><link rel="stylesheet" href="../../assets/css/style.css?v=69"></head>
<body data-base="../../">
<header class="site"><div class="wrap nav"><a class="logo" href="../../"><img class="logo-mark" src="../../favicon.svg" alt="">サカミチ<span class="grad">ア</span></a><nav><a href="../../">ホーム</a><a href="../../members/">メンバー</a><a href="../" class="on">楽曲図鑑</a><a href="../../live/">歴代ライブ</a><a href="../../blog/">ブログ</a><a href="../../games/">ミニゲーム</a><a href="../../formation/">マイフォーメーション</a><a href="../../setlist/">マイセットリスト</a><a href="../../news/">お知らせ</a></nav></div></header>
<main class="wrap"><section class="page">
<p style="margin:0 0 10px"><a href="../">← 楽曲図鑑に戻る</a></p>
<h2 class="title">{esc(s['title'])}<span style="font-size:14px;color:var(--muted);margin-left:10px">{esc(s.get('yomi') or '')}</span></h2>
<div class="sg-detail">{hero_img}<div class="sg-info">{''.join(info)}</div></div>
{''.join(body)}{live_html}{sib_html}{nav_html}
</section></main>
<footer><div class="wrap">サカミチアは個人運営の非公式ファンサイトです。公式運営とは関係ありません。記事・写真・楽曲の権利は各権利者に帰属します。</div></footer>
{('<script type="application/json" id="songData">' + json.dumps(song_json, ensure_ascii=False) + '</script>') if song_json else ''}
<script src="../../assets/js/common.js"></script><script src="../../assets/js/song-page.js"></script>
</body></html>
"""
        dest_dir = os.path.join(ROOT, "songs", sid)
        os.makedirs(dest_dir, exist_ok=True)
        with open(os.path.join(dest_dir, "index.html"), "w", encoding="utf-8") as fh:
            fh.write(page)
        pages += 1

        if have_pil:
            sub1 = grp + (f" ・ {s['date']}発売" if s.get("date") else "") + (f" ・ {s['type']}" if s.get("type") else "")
            sub2 = f"センター：{s['center']}" if s.get("center") else ""
            data = make_ogp(s, jack_file, sub1, sub2)
            ogp_dir = os.path.join(ROOT, "assets", "ogp", "songs")
            os.makedirs(ogp_dir, exist_ok=True)
            ogp_path = os.path.join(ogp_dir, sid + ".jpg")
            old = None
            if os.path.exists(ogp_path):
                with open(ogp_path, "rb") as fh:
                    old = fh.read()
            if old != data:
                with open(ogp_path, "wb") as fh:
                    fh.write(data)
                ogp_changed += 1

    sm_path = os.path.join(ROOT, "sitemap.xml")
    with open(sm_path, encoding="utf-8") as fh:
        sm = fh.read()
    start_marker, end_marker = "<!-- song-pages:start -->", "<!-- song-pages:end -->"
    block = start_marker + "\n" + "\n".join(
        f'  <url><loc>{BASE_URL}/songs/{str(s["id"]).lower()}/</loc><priority>0.6</priority></url>'
        for s in songs) + "\n" + end_marker
    if start_marker in sm:
        a = sm.index(start_marker)
        b = sm.index(end_marker) + len(end_marker)
        sm = sm[:a] + block + sm[b:]
    else:
        sm = sm.replace("</urlset>", block + "\n</urlset>")
    with open(sm_path, "w", encoding="utf-8") as fh:
        fh.write(sm)

    print(f"song pages: {pages}, ogp updated: {ogp_changed}")


if __name__ == "__main__":
    main()
