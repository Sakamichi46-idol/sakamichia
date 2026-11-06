#!/usr/bin/env python3
"""メンバー個別ページ（/members/<slug>/）とメンバー別OGP画像を生成する。

メンバー一覧（assets/js/members.js）の詳細ダイアログと同じ内容を、
検索エンジンと共有（OGP）に効く静的HTMLとして書き出す。
数値類（センター曲・参加曲・ライブ記録・ブログ件数・学年・隣接統計）は
members.js のロジックをそのまま移植してビルド時に計算する。
日々変わるのはブログ件数くらいなので、daily ワークフローで再生成する。

入力: data/members.json, member-photos.json, member-galleries.json,
      member-meta.json, member-live.json, songs.json, formations.json,
      blogs/index.json
出力: members/<slug>/index.html（206人分）、assets/ogp/members/<slug>.jpg、
      sitemap.xml のメンバーページ区間（マーカーの間を差し替え）
"""
import html
import io
import json
import os
import urllib.parse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BASE_URL = "https://sakamichia.pages.dev"
GCOL = {"乃木坂46": "#7e57c2", "櫻坂46": "#e77a9b", "日向坂46": "#5aa9d6",
        "欅坂46": "#5eba53", "けやき坂46": "#a4c639"}
ERA_RANK = {"けやき坂46": 1, "欅坂46": 2, "櫻坂46": 3, "日向坂46": 3, "乃木坂46": 0}
EXCHANGE = "松井玲奈"  # SKE48からの交換留学生


def load(name):
    with open(os.path.join(ROOT, "data", name), encoding="utf-8") as f:
        return json.load(f)


def esc(s):
    return html.escape(str(s), quote=True)


def last_group(m):
    gs = m.get("groups") or [m.get("group")]
    best, br = m.get("group"), -1
    for g in gs:
        r = ERA_RANK.get(g, 0)
        if r > br:
            br, best = r, g
    return best


def cohort_of(meta, name):
    b = (meta.get(name) or {}).get("b")
    if not (isinstance(b, list) and len(b) == 3):
        return None
    y, mo, d = b
    return y if (mo > 4 or (mo == 4 and d >= 2)) else y - 1


def main():
    members = load("members.json")
    photos = load("member-photos.json")
    galleries = load("member-galleries.json")
    meta = load("member-meta.json")
    member_live = load("member-live.json")
    songs = load("songs.json")
    formations = load("formations.json")
    bidx = load("blogs/index.json")

    blog_counts = {}
    for k, v in (bidx.get("memberCounts") or {}).items():
        nm = k.split("|")[-1]
        blog_counts[nm] = blog_counts.get(nm, 0) + v

    slug_of = {}
    for m in members:
        slug_of[m["name"]] = photos[m["name"]].replace(".jpg", "").replace("_", "-")

    cohorts = {}
    for m in members:
        c = cohort_of(meta, m["name"])
        if c is not None:
            cohorts[c] = cohorts.get(c, 0) + 1

    def center_songs(name, title_only=False):
        out = [s for s in songs
               if s.get("center") and name in s["center"].split("・")
               and (not title_only or s.get("type") == "表題曲")]
        out.sort(key=lambda s: (s.get("date") or "", s.get("ord") or 0))
        return out

    def form_count(name):
        n = 0
        for f in formations.values():
            if f.get("external"):
                continue
            if (f.get("rows") and name in [x for row in f["rows"] for x in row]) \
               or name in (f.get("vocal") or []):
                n += 1
        return n

    def formation_stats(name):
        cnt, front, nb = 0, 0, {}
        for f in formations.values():
            if f.get("external") or not f.get("rows"):
                continue
            for r, row in enumerate(f["rows"]):
                if name not in row:
                    continue
                cnt += 1
                if r == len(f["rows"]) - 1:
                    front += 1
                p = row.index(name)
                for x in (row[p - 1] if p > 0 else None, row[p + 1] if p + 1 < len(row) else None):
                    if x:
                        nb[x] = nb.get(x, 0) + 1
        top = sorted(nb.items(), key=lambda kv: -kv[1])[:3]
        return cnt, front, top

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
        # GitHub Actions 等フォントパスが違う環境では fc-list から探す
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
        INK = (43, 36, 48); GRAY = (110, 102, 118)
        NC, SC, HC = (126, 87, 194), (231, 122, 155), (90, 169, 214)
        PALE = [(244, 239, 252), (253, 240, 244), (237, 246, 251)]

        def make_ogp(m, lg, sub1, sub2, photo_path):
            W, H = 1200, 630
            img = Image.new("RGB", (W, H))
            px = img.load()
            stops = [(0.0, PALE[0]), (0.52, PALE[1]), (1.0, PALE[2])]
            for x in range(W):
                t = x / (W - 1)
                col = PALE[-1]
                for i in range(len(stops) - 1):
                    if stops[i][0] <= t <= stops[i + 1][0]:
                        a, b = stops[i], stops[i + 1]
                        u = (t - a[0]) / (b[0] - a[0])
                        col = tuple(int(a[1][k] + (b[1][k] - a[1][k]) * u) for k in range(3))
                for y in range(H):
                    px[x, y] = col
            d = ImageDraw.Draw(img)
            for i, c in enumerate([NC, SC, HC]):
                d.ellipse([64 + i * 30, 60, 64 + i * 30 + 18, 78], fill=c)
            d.text((160, 50), "サカミチア", font=ImageFont.truetype(FB, 40), fill=INK)
            name = m["name"]
            d.text((64, 216), name, font=ImageFont.truetype(FB, 96 if len(name) <= 5 else 80), fill=INK)
            d.text((68, 348), sub1, font=ImageFont.truetype(FR, 33), fill=INK)
            d.text((68, 400), sub2, font=ImageFont.truetype(FR, 28), fill=GRAY)
            # 右側にメイン写真（縦タイル）
            tw, th = 324, 446
            src = Image.open(photo_path).convert("RGB")
            sw, sh = src.size
            scale = max(tw / sw, th / sh)
            src = src.resize((int(sw * scale) + 1, int(sh * scale) + 1))
            x0 = (src.size[0] - tw) // 2
            y0 = int((src.size[1] - th) * 0.28)
            src = src.crop((x0, y0, x0 + tw, y0 + th))
            mask = Image.new("L", (tw, th), 0)
            ImageDraw.Draw(mask).rounded_rectangle([0, 0, tw, th], 24, fill=255)
            img.paste(src, (812, 92), mask)
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=82)
            return buf.getvalue()

    pages = 0
    for m in members:
        name = m["name"]
        slug = slug_of[name]
        lg = last_group(m)
        stem = photos[name].replace(".jpg", "")
        gal = galleries.get(name) or []
        latest = gal[-1] if gal else None

        def gal_url(f):
            return f"../../assets/member-gallery/{stem}/{f}"

        if latest:
            main_url = gal_url(latest["f"])
            main_file = os.path.join(ROOT, "assets", "member-gallery", stem, latest["f"])
            main_cap = f"{latest.get('t') or 'アー写'}{('（' + str(latest['y']) + '年）') if latest.get('y') else ''}・最新"
        else:
            main_url = f"../../assets/member-photos/{photos[name]}"
            main_file = os.path.join(ROOT, "assets", "member-photos", photos[name])
            main_cap = "現在のアー写"

        cs = center_songs(name)
        cst = center_songs(name, True)
        fc = form_count(name)
        ls = member_live.get(name) or {}
        blogs = blog_counts.get(name, 0)
        cohort = cohort_of(meta, name)
        fcnt, ffront, ftop = formation_stats(name)
        others = [g for g in (m.get("groups") or []) if g != lg]
        gen_txt = "交換留学生（SKE48から）" if name == EXCHANGE else (f"{m['gen']}期生" if m.get("gen") else "")
        status = "卒業・活動終了" if m.get("graduated") else "現役"

        desc = (f"{name}（{lg}{'・' + gen_txt if gen_txt else ''}）の個別ページ。"
                f"センター曲{len(cs)}曲、フォーメーション/歌唱参加{fc}曲、ライブ出演{ls.get('shows', 0)}公演、"
                f"ブログ{blogs}件、歴代アー写{len(gal)}枚。非公式ファンサイト「サカミチア」。")
        title = f"{name}（{lg}）のプロフィール・センター曲・参加曲 | サカミチア"
        url = f"{BASE_URL}/members/{slug}/"
        ogp_url = f"{BASE_URL}/assets/ogp/members/{slug}.jpg"

        gal_html = ""
        if len(gal) >= 2:
            thumbs = ""
            for i, g in enumerate(gal):
                is_latest = i == len(gal) - 1
                cap = f"{g.get('t') or 'アー写'}{('（' + str(g['y']) + '年）') if g.get('y') else ''}{'・最新' if is_latest else ''}"
                lab = str(g["y"]) if g.get("y") else ((g.get("t") or "")[:6] or f"{i + 1}枚目")
                thumbs += (f'<button type="button" class="mb-gal-th{" on" if is_latest else ""}" '
                           f'data-src="{esc(gal_url(g["f"]))}" data-cap="{esc(cap)}" data-f="{esc(g["f"])}">'
                           f'<img loading="lazy" src="{esc(gal_url(g["f"]))}" alt=""><span>{esc(lab)}</span></button>')
            gal_html = (f'<div class="mb-gal"><h4 style="margin:14px 0 6px">歴代アー写など（{len(gal)}枚）</h4>'
                        f'<div class="mb-gal-strip">{thumbs}</div>'
                        f'<p class="mb-gal-note">タップすると上の写真が切り替わります。上の写真をタップすると最新のアー写に戻ります。</p></div>')

        cohort_html = ""
        if cohort is not None:
            cohort_html = (f'<p>学年：<b>{cohort}年度</b>（<a href="../../school-years/#y{cohort}">'
                           f'同級生 全{cohorts.get(cohort, 0)}人を見る</a>）</p>')
        fstats_html = ""
        if fcnt:
            nb = ""
            if ftop:
                links = "、".join(
                    f'<a href="../{slug_of[n]}/">{esc(n)}</a>（{c}回）' for n, c in ftop)
                nb = f"<br>よく隣になるメンバー：{links}"
            fstats_html = (f'<p>フォーメーション統計：登場 <b>{fcnt}曲</b>・'
                           f'フロント（1列目）<b>{ffront}曲</b>{nb}</p>')
        cs_html = ""
        if cs:
            links = "、".join(
                f'<a href="../../songs/{str(s["id"]).lower()}/">{esc(s["title"])}</a>' for s in cs)
            cs_html = f'<h4 style="margin:10px 0 4px">センター曲</h4><p style="line-height:2">{links}</p>'

        member_json = json.dumps({
            "name": name,
            "latestF": latest["f"] if latest else None,
            "latestSrc": main_url,
            "latestCap": main_cap,
        }, ensure_ascii=False)

        page = f"""<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)}</title><meta name="description" content="{esc(desc)}"><link rel="icon" href="../../favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="../../apple-touch-icon.png"><meta name="theme-color" content="#faf9fb"><meta property="og:type" content="profile"><meta property="og:site_name" content="サカミチア"><meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}"><meta property="og:url" content="{url}"><link rel="canonical" href="{url}"><meta property="og:image" content="{ogp_url}"><meta name="twitter:card" content="summary_large_image"><link rel="stylesheet" href="../../assets/css/style.css?v=75"></head>
<body data-base="../../">
<header class="site"><div class="wrap nav"><a class="logo" href="../../"><img class="logo-mark" src="../../favicon.svg" alt="">サカミチ<span class="grad">ア</span></a><nav><a href="../../">ホーム</a><a href="../" class="on">メンバー</a><a href="../../songs/">楽曲図鑑</a><a href="../../live/">歴代ライブ</a><a href="../../blog/">ブログ</a><a href="../../games/">ミニゲーム</a><a href="../../formation/">マイフォーメーション</a><a href="../../setlist/">マイセットリスト</a><a href="../../news/">お知らせ</a></nav></div></header>
<main class="wrap"><section class="page">
<p style="margin:0 0 10px"><a href="../">← メンバー一覧に戻る</a></p>
<h2 class="title">{esc(name)}<span style="font-size:14px;color:var(--muted);margin-left:10px">{esc(m.get('reading') or '')}</span></h2>
<div class="mb-detail">
<div class="mb-dphoto"><img id="mbMainImg" src="{esc(main_url)}" alt="{esc(name)}"><p class="mb-cap" id="mbMainCap">{esc(main_cap)}</p></div>
<div class="mb-dinfo">
<p><span class="chip g-{esc(lg)}">{esc(lg)}</span>{(' ' + esc(gen_txt)) if gen_txt else ''} ・ <b>{esc(status)}</b>{('<br>所属歴：' + esc('、'.join(others))) if others else ''}</p>
<p>センター曲：<b>{len(cs)}曲</b>（シングル表題曲センター：<b>{len(cst)}曲</b>）　フォーメーション/歌唱参加：<b>{fc}曲</b><br>ライブ記録：センター <b>{ls.get('centers', 0)}公演</b>・出演記録のある公演 <b>{ls.get('shows', 0)}公演</b><br>ブログ記事：<b>{blogs}件</b></p>
{cohort_html}{fstats_html}{cs_html}
<p class="mb-links"><a class="btn" href="../../blog/?member={urllib.parse.quote(name)}">この人のブログを見る</a> <a class="btn" href="../../live/?member={urllib.parse.quote(name)}">ライブ記録で見る</a> <button type="button" class="btn" id="favBtn" aria-pressed="false">☆ 推しに登録</button></p>
<p style="color:var(--muted);font-size:12px;margin:2px 0 0">推しに登録すると、トップページに「推しの新着」（最新のブログ）が出ます。</p>
</div>
</div><div id="memberSched"></div>{gal_html}<div id="favPhotoRow"></div>
</section></main>
<footer><div class="wrap">サカミチアは個人運営の非公式ファンサイトです。公式運営とは関係ありません。記事・写真・楽曲の権利は各権利者に帰属します。</div></footer>
<script type="application/json" id="memberData">{member_json}</script>
<script src="../../assets/js/common.js"></script><script src="../../assets/js/member-page.js"></script>
</body></html>
"""
        dest_dir = os.path.join(ROOT, "members", slug)
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, "index.html")
        with open(dest, "w", encoding="utf-8") as f:
            f.write(page)
        pages += 1

        if have_pil:
            sub1 = lg + (f" ・ {m['gen']}期生" if m.get("gen") else (" ・ 交換留学生" if name == EXCHANGE else "")) \
                + (" ・ 卒業" if m.get("graduated") else "")
            sub2 = f"センター曲 {len(cs)}曲 ・ フォーメーション参加 {fc}曲"
            data = make_ogp(m, lg, sub1, sub2, main_file)
            ogp_dir = os.path.join(ROOT, "assets", "ogp", "members")
            os.makedirs(ogp_dir, exist_ok=True)
            ogp_path = os.path.join(ogp_dir, slug + ".jpg")
            old = None
            if os.path.exists(ogp_path):
                with open(ogp_path, "rb") as f:
                    old = f.read()
            if old != data:
                with open(ogp_path, "wb") as f:
                    f.write(data)
                ogp_changed += 1

    # sitemap.xml のメンバー区間を差し替え
    sm_path = os.path.join(ROOT, "sitemap.xml")
    with open(sm_path, encoding="utf-8") as f:
        sm = f.read()
    start_marker, end_marker = "<!-- member-pages:start -->", "<!-- member-pages:end -->"
    block = start_marker + "\n" + "\n".join(
        f'  <url><loc>{BASE_URL}/members/{slug_of[m["name"]]}/</loc><priority>0.6</priority></url>'
        for m in members) + "\n" + end_marker
    if start_marker in sm:
        a = sm.index(start_marker)
        b = sm.index(end_marker) + len(end_marker)
        sm = sm[:a] + block + sm[b:]
    else:
        sm = sm.replace("</urlset>", block + "\n</urlset>")
    with open(sm_path, "w", encoding="utf-8") as f:
        f.write(sm)

    print(f"member pages: {pages}, ogp updated: {ogp_changed}")


if __name__ == "__main__":
    main()
