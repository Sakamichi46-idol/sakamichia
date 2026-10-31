#!/usr/bin/env python3
"""n46db のメンバー写真ギャラリーから歴代アーティスト写真を取り込む。

- ギャラリーURLはプロフィールURLの profile.php → members/membergallery.php 置換で得る
- 各写真はシングル表題曲（タイトル・年）と対応しているので、キャプションも一緒に保存する
- 保存先: assets/member-gallery/<ローマ字stem>/sNNN.jpg など
- 索引: data/member-galleries.json {名前: [{f, t, y, c?}]}（c は現在のプロフィール写真と同一のもの）
- 再実行安全（既存ファイルはスキップ）。ポカは対象外。
- data/member-gallery-extra.json に載せた手動追加分は、n46db のギャラリー
  ページに未掲載でも再構築で消えないよう、各メンバーの末尾にマージする
  （現在のプロフィール写真が新アー写に変わったがギャラリー未掲載のケース用。
  同じ f が既にあれば二重に追加しない）
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from urllib.parse import quote, urljoin

ROOT = 'https://n46db.com/'
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
LIST_PAGES = [
    'saka/saka-memberlist.php',
    'saka/saka-memberlist.php?graduated=yes',
]
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, 'assets', 'member-gallery')
INDEX_PATH = os.path.join(BASE, 'data', 'member-galleries.json')
EXTRA_PATH = os.path.join(BASE, 'data', 'member-gallery-extra.json')
PHOTOS_PATH = os.path.join(BASE, 'data', 'member-photos.json')


def curl(url, binary=False):
    url = quote(url, safe=':/?&=%.-_~')
    last = None
    for attempt in range(3):
        r = subprocess.run(['curl', '-s', '-A', UA['User-Agent'], url],
                           capture_output=True, timeout=60)
        if r.returncode == 0:
            return r.stdout if binary else r.stdout.decode('utf-8', 'ignore')
        last = RuntimeError(f'curl failed: {url}')
        time.sleep(2 + attempt * 3)
    raise last


def build_profiles():
    profiles = {}
    for page in LIST_PAGES:
        html = curl(urljoin(ROOT, page))
        for href, name in re.findall(r'href="([^"]*profile\.php[^"]*)"[^>]*>([^<]+)', html):
            nm = unicodedata.normalize('NFKC', name).replace(' ', '').replace('　', '').strip()
            if nm and nm not in profiles:
                profiles[nm] = urljoin(ROOT + 'saka/', href)
    return profiles


def gallery_url(profile_url):
    return profile_url.replace('/profile.php', '/members/membergallery.php')


def parse_gallery(html):
    """[(src相対パス, タイトル, 年)] を出現順に返す。"""
    out = []
    seen = set()
    for m in re.finditer(r'pictures/((?:profilepics|k46|h46)/[a-z]\d{3}/[a-z0-9_]+\.jpg)', html):
        src = m.group(1)
        if src in seen:
            continue
        seen.add(src)
        tail = html[m.end():m.end() + 500]
        t = y = None
        sm = re.search(r'song\.php[^"]*"[^>]*>([^<]+)</a>', tail)
        if sm:
            t = sm.group(1).strip()
        ym = re.search(r'（(\d{4})年', tail)
        if ym:
            y = int(ym.group(1))
        out.append((src, t, y))
    return out


def md5(b):
    return hashlib.md5(b).hexdigest()


def load_extras():
    try:
        with open(EXTRA_PATH, encoding='utf-8') as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def apply_extras(extra_items, items, mdir):
    """手動追加分を末尾にマージする（同じ f は追加せず、実ファイルがある分だけ）。"""
    have = {it['f'] for it in items}
    for ex in extra_items:
        fn = ex.get('f')
        if not fn or fn in have:
            continue
        if not os.path.exists(os.path.join(mdir, fn)):
            continue
        items.append(dict(ex))
        have.add(fn)
    return items


def main():
    members = json.load(open(os.path.join(BASE, 'data', 'members.json'), encoding='utf-8'))
    photos = json.load(open(PHOTOS_PATH, encoding='utf-8'))
    profiles = build_profiles()
    print('profile urls found:', len(profiles), flush=True)
    extras_all = load_extras()
    os.makedirs(OUT_DIR, exist_ok=True)
    index = {}
    total_files = 0
    for i, mb in enumerate(members):
        name = mb['name']
        if name not in photos or name not in profiles:
            continue
        stem = photos[name][:-4]  # .jpg を除いたローマ字stem
        mdir = os.path.join(OUT_DIR, stem)
        try:
            html = curl(gallery_url(profiles[name]))
        except Exception as e:
            print('GALLERY FAIL', name, e, flush=True)
            continue
        entries = parse_gallery(html)
        if not entries:
            continue
        os.makedirs(mdir, exist_ok=True)
        cur_hash = None
        cur_path = os.path.join(BASE, 'assets', 'member-photos', photos[name])
        if os.path.exists(cur_path):
            cur_hash = md5(open(cur_path, 'rb').read())
        # 未取得分を4並列でダウンロード（n46dbへの負荷を抑えた控えめな並列度）
        from concurrent.futures import ThreadPoolExecutor
        def dl(job):
            src, lp = job
            try:
                data = curl(urljoin(ROOT, 'pictures/' + src), binary=True)
            except Exception as e:
                print('DL FAIL', name, src, e, flush=True)
                return False
            ok_magic = (data[:2] == b'\xff\xd8' or data[:4] == b'\x89PNG'
                        or (data[:4] == b'RIFF' and data[8:12] == b'WEBP'))
            if len(data) < 1000 or not ok_magic:
                print('BAD IMG', name, src, len(data), flush=True)
                return False
            open(lp, 'wb').write(data)
            return True
        jobs = []
        for src, t, y in entries:
            fn = src.split('/')[-2] + '.jpg'   # ローカル名は時代フォルダ名（s001.jpg等）。ファイル名は全員ローマ字で共通のため
            lp = os.path.join(mdir, fn)
            if not os.path.exists(lp):
                jobs.append((src, lp))
        if jobs:
            with ThreadPoolExecutor(max_workers=4) as ex:
                list(ex.map(dl, jobs))
        items = []
        for src, t, y in entries:
            fn = src.split('/')[-2] + '.jpg'
            lp = os.path.join(mdir, fn)
            if not os.path.exists(lp):
                continue
            total_files += 1
            item = {'f': fn}
            if t:
                item['t'] = t
            if y:
                item['y'] = y
            if cur_hash and md5(open(lp, 'rb').read()) == cur_hash:
                item['c'] = True
            items.append(item)
        if name in extras_all:
            items = apply_extras(extras_all[name], items, mdir)
        if items:
            index[name] = items
        # 索引は逐次保存する（途中で止まっても、済んだ分は使えるように）
        json.dump(index, open(INDEX_PATH, 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1, sort_keys=True)
        if (i + 1) % 40 == 0:
            print(f'{i + 1}/{len(members)} members, files so far {total_files}', flush=True)
    json.dump(index, open(INDEX_PATH, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1, sort_keys=True)
    print('members with gallery:', len(index), '| total files:', total_files, flush=True)


if __name__ == '__main__':
    sys.exit(main())
