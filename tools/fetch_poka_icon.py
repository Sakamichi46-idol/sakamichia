#!/usr/bin/env python3
"""ポカ（日向坂46公式マスコット）の「アー写」として、公式ブログの
プロフィールアイコンを扱うためのチェック＆追加スクリプト。

ルール（2026-10-31 ユーザー決定）:
- ポカには通常のアー写が無いので、公式ブログ（hinatazaka46.com の
  ポカ公式ブログ）のプロフィールアイコンが変わったら、それを新しい
  アー写とみなしてギャラリーの末尾に追加する。
- ギャラリーの正は data/member-gallery-extra.json の「ポカ」項目とし、
  data/member-galleries.json にも同じ内容を反映する
  （fetch_member_galleries.py の再構築では extras から復元される）。
- 最初の項目（icon-00.jpg）はユーザー提供写真のコピー。消さない・上書きしない。
- アイコンの取得元はポカのブログ一覧ページの
  `.c-blog-member__icon` の background-image。URLパターンが変わって
  取得できない日はスキップし、既存データは一切壊さない。
"""
import datetime
import json
import os
import re
import subprocess
import sys
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GALLERY_DIR = os.path.join(BASE, 'assets', 'member-gallery', 'poka')
USER_PHOTO = os.path.join(BASE, 'assets', 'member-photos', 'poka.jpg')
INDEX_PATH = os.path.join(BASE, 'data', 'member-galleries.json')
EXTRA_PATH = os.path.join(BASE, 'data', 'member-gallery-extra.json')
NAME = 'ポカ'
LIST_URL = 'https://www.hinatazaka46.com/s/official/diary/member/list?ima=0000&ct=000'
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
# 知覚ハッシュの同一判定しきい値（16x16=256bit）。
# 実測：同一イラストの再圧縮版は aHash 0 / dHash 17、別人写真は aHash 93 / dHash 132。
AHASH_MAX = 24
DHASH_MAX = 48


def curl(url, binary=False):
    last = None
    for attempt in range(3):
        r = subprocess.run(['curl', '-s', '-A', UA['User-Agent'], url],
                           capture_output=True, timeout=60)
        if r.returncode == 0 and r.stdout:
            return r.stdout if binary else r.stdout.decode('utf-8', 'ignore')
        last = RuntimeError(f'curl failed: {url}')
        time.sleep(2 + attempt * 3)
    raise last


def find_icon_url(html):
    """ポカのブログ一覧ページHTMLからプロフィールアイコンのURLを取り出す。"""
    m = re.search(r'class="c-blog-member__icon"[^>]*background-image\s*:\s*url\(([^)]+)\)', html)
    if m:
        return m.group(1).strip('\'"')
    # フォールバック：メンバー情報ブロック内の images/14/ 配下の画像
    blk = re.search(r'p-blog-member__info.*?</table>', html, re.S)
    if blk:
        m2 = re.search(r'url\((https://cdn\.hinatazaka46\.com/images/[^)]+)\)', blk.group(0))
        if m2:
            return m2.group(1)
    return None


def get_icon_bytes():
    """現在の公式ブログアイコンの (URL, バイト列) を返す。取れなければ例外。"""
    html = curl(LIST_URL)
    url = find_icon_url(html)
    if not url:
        raise RuntimeError('icon url not found in blog page')
    data = curl(url, binary=True)
    ok_magic = (data[:2] == b'\xff\xd8' or data[:4] == b'\x89PNG'
                or (data[:4] == b'RIFF' and data[8:12] == b'WEBP'))
    if len(data) < 1000 or not ok_magic:
        raise RuntimeError(f'bad icon image: {len(data)} bytes')
    return url, data


def _hashes(img_bytes):
    """(aHash, dHash) を 16x16 ビットのリストで返す。"""
    import io
    from PIL import Image
    im = Image.open(io.BytesIO(img_bytes)).convert('L')
    px = list(im.resize((16, 16)).getdata())
    avg = sum(px) / len(px)
    ahash = [1 if p > avg else 0 for p in px]
    px2 = list(im.resize((17, 16)).getdata())
    dhash = [1 if px2[r * 17 + c] > px2[r * 17 + c + 1] else 0
             for r in range(16) for c in range(16)]
    return ahash, dhash


def is_same_image(bytes_a, bytes_b):
    """知覚ハッシュで同一画像かどうかを判定する。"""
    ha = _hashes(bytes_a)
    hb = _hashes(bytes_b)
    da = sum(x != y for x, y in zip(ha[0], hb[0]))
    dd = sum(x != y for x, y in zip(ha[1], hb[1]))
    return da <= AHASH_MAX and dd <= DHASH_MAX


def load_json(path, default):
    try:
        with open(path, encoding='utf-8') as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else default
    except Exception:
        return default


def dump_json(path, data):
    json.dump(data, open(path, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1, sort_keys=True)


def load_state():
    """ポカのギャラリー項目リストを返す（extras を正とし、無ければ索引から）。"""
    extras = load_json(EXTRA_PATH, {})
    if extras.get(NAME):
        return list(extras[NAME])
    index = load_json(INDEX_PATH, {})
    return list(index.get(NAME) or [])


def save_state(items):
    extras = load_json(EXTRA_PATH, {})
    extras[NAME] = items
    dump_json(EXTRA_PATH, extras)
    index = load_json(INDEX_PATH, {})
    index[NAME] = items
    dump_json(INDEX_PATH, index)


def next_icon_name(items):
    mx = -1
    for it in items:
        m = re.match(r'icon-(\d+)\.jpg$', it.get('f') or '')
        if m:
            mx = max(mx, int(m.group(1)))
    return f'icon-{mx + 1:02d}.jpg'


def run(get_bytes=get_icon_bytes):
    """アイコンを確認し、変わっていたら末尾に追加する。結果文字列を返す。"""
    try:
        from PIL import Image  # noqa: F401
    except Exception:
        return 'SKIP: Pillow not available'
    items = load_state()
    if not items:
        return 'SKIP: poka gallery state is empty'
    # 比較相手はギャラリー最新項目の実ファイル（無ければユーザー提供写真そのもの）
    latest_path = os.path.join(GALLERY_DIR, items[-1].get('f') or '')
    if not os.path.exists(latest_path):
        latest_path = USER_PHOTO
    if not os.path.exists(latest_path):
        return 'SKIP: latest gallery file missing'
    try:
        url, icon = get_bytes()
    except Exception as e:
        return f'SKIP: icon fetch failed ({e})'
    current = open(latest_path, 'rb').read()
    if is_same_image(icon, current):
        return f'UNCHANGED: icon same as {os.path.basename(latest_path)}'
    os.makedirs(GALLERY_DIR, exist_ok=True)
    fn = next_icon_name(items)
    with open(os.path.join(GALLERY_DIR, fn), 'wb') as fh:
        fh.write(icon)
    items.append({'f': fn, 't': '公式ブログアイコン',
                  'y': datetime.date.today().year})
    save_state(items)
    return f'ADDED: {fn} from {url} (total {len(items)} items)'


def main():
    print(run(), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
