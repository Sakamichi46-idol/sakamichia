#!/usr/bin/env python3
"""3グループ公式サイトの「お知らせ」を集めて data/news.json を作る。

- 乃木坂46: 公式JSON API /s/n46/api/list/news_v2?dy=YYYYMM
- 櫻坂46: 一覧HTML（?dy=YYYYMM）を解析
- 日向坂46: 一覧HTML（?dy=YYYYMM）を解析（別マークアップ）
- 欅坂46・けやき坂46: 欅坂46公式サイト（keyakizaka46.com/s/k46o/、アーカイブとして現存）の
  一覧HTML（?dy=YYYYMM）を解析。両グループ混在の一覧で、タイトルが「けやき坂46」で
  始まるものを けやき坂46、それ以外を 欅坂46 とする。到達範囲は 2015年10月〜2020年11月。
  櫻坂46と (日付,タイトル) が一致するものは櫻坂46側を残し、欅坂46側を落とす。
- 保存するのは日付・カテゴリ・タイトル・公式記事URLのみ（本文は持たない）
- 既存ファイルとマージし、取得できた全期間を新しい順に保持（件数・期間の上限なし）。
  遡及取得は --months N で行う（例: --months 190 で約16年分）。
  公式側の到達範囲: 乃木坂46=2012年〜（API）、櫻坂46=2020年10月〜、日向坂46=2019年2月〜。
  中身が変わったときだけ書き換える（自動更新の無駄なコミット防止）。
"""
import html as htmllib
import json
import os
import re
import subprocess
import sys
from datetime import date, timedelta

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'data', 'news.json')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

NOGI_CATE = {
    'web': 'WEB', 'mobile': 'モバイル', 'live': 'ライブ', 'release': 'リリース',
    'tv': 'TV', 'goods': 'グッズ', 'tieup': 'タイアップ', 'meetandgreet': 'ミーグリ',
    'meet': 'イベント', 'other': 'その他', 'musical': '舞台', 'movie': '映画',
    'streaming': '配信', 'book': '書籍', 'radio': 'ラジオ',
}


def fetch(url):
    r = subprocess.run(['curl', '-s', '-A', UA, url], capture_output=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f'curl failed: {url}')
    return r.stdout.decode('utf-8', 'ignore')


def months_back(n):
    out = []
    y, m = date.today().year, date.today().month
    for _ in range(n):
        out.append(f'{y:04d}{m:02d}')
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def clean(s):
    return htmllib.unescape(re.sub(r'<[^>]+>', '', s or '')).replace('　', ' ').strip()


def nogi(months):
    items = []
    for dy in months:
        d = json.loads(fetch(f'https://www.nogizaka46.com/s/n46/api/list/news_v2?dy={dy}'))
        for it in d.get('data', []):
            dt = it.get('date', '')  # "2026/10/28 22:03:54"
            m = re.match(r'(\d{4})/(\d{2})/(\d{2})(?:\s+(\d{2}):(\d{2}))?', dt)
            if not m:
                continue
            items.append({
                'd': f'{m.group(1)}-{m.group(2)}-{m.group(3)}',
                't': f'{m.group(4)}:{m.group(5)}' if m.group(4) else '',
                'g': '乃木坂46',
                'c': NOGI_CATE.get(it.get('cate', ''), it.get('cate', '')),
                'title': clean(it.get('title', '')),
                'url': f"https://www.nogizaka46.com/s/n46/news/detail/{it.get('code')}",
            })
    return items


def sakura(months):
    items = []
    pat = re.compile(r'href="(/s/s46/news/detail/[A-Z0-9]+)[^"]*"[^>]*>\s*<div class="title-part[^"]*">\s*<p class="type">([^<]+)</p>\s*<p class="date[^"]*">([0-9.]+)</p>\s*</div>\s*<p class="lead">(.*?)</p>', re.S)
    for dy in months:
        h = fetch(f'https://sakurazaka46.com/s/s46/news/list?ima=0000&dy={dy}')
        for href, typ, dt, lead in pat.findall(h):
            items.append({
                'd': dt.replace('.', '-'), 't': '', 'g': '櫻坂46',
                'c': clean(typ), 'title': clean(lead),
                'url': 'https://sakurazaka46.com' + href,
            })
    return items


def hinata(months):
    items = []
    pat = re.compile(r'href="(/s/official/news/detail/[A-Z0-9]+)[^"]*"[^>]*>\s*<time class="c-news__date">([0-9.]+)</time>\s*<div class="c-news__category[^"]*">([^<]+)</div>\s*<p class="c-news__text">(.*?)</p>', re.S)
    for dy in months:
        h = fetch(f'https://www.hinatazaka46.com/s/official/news/list?ima=0000&dy={dy}')
        for href, dt, cat, text in pat.findall(h):
            items.append({
                'd': dt.replace('.', '-'), 't': '', 'g': '日向坂46',
                'c': clean(cat), 'title': clean(text),
                'url': 'https://www.hinatazaka46.com' + href,
            })
    return items


def keyaki(months):
    items = []
    pat = re.compile(r'<div class="date[^"]*">\s*([0-9.]+)\s*</div>\s*<div class="category[^"]*">\s*(.*?)\s*</div>\s*<div class="text">\s*<a href="(/s/k46o/news/detail/[A-Z0-9]+)[^"]*">(.*?)</a>', re.S)
    for dy in months:
        h = fetch(f'https://www.keyakizaka46.com/s/k46o/news/list?dy={dy}')
        for dt, cat, href, title in pat.findall(h):
            t = clean(title)
            items.append({
                'd': dt.replace('.', '-'), 't': '',
                'g': 'けやき坂46' if t.startswith('けやき坂46') else '欅坂46',
                'c': clean(cat), 'title': t,
                'url': 'https://www.keyakizaka46.com' + href,
            })
    return items


def main():
    months_n = 2
    if '--months' in sys.argv:
        months_n = int(sys.argv[sys.argv.index('--months') + 1])
    months = months_back(months_n)
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]
    fresh = []
    for fn, label in [(nogi, 'nogi'), (sakura, 'sakura'), (hinata, 'hinata'), (keyaki, 'keyaki')]:
        if only and label != only:
            continue
        try:
            got = fn(months)
            print(label, 'fetched:', len(got), flush=True)
            fresh += got
        except Exception as e:
            print(label, 'FAILED:', e, flush=True)
    old = []
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8')).get('items', [])
        except Exception:
            old = []
    by_url = {it['url']: it for it in old}
    for it in fresh:
        if it['title']:
            by_url[it['url']] = it
    # 欅坂46サイトと櫻坂46サイトに同じお知らせがある場合は櫻坂46側を残す
    saku_keys = {(it['d'], it['title']) for it in by_url.values() if it['g'] == '櫻坂46'}
    items = [it for it in by_url.values()
             if not (it['g'] in ('欅坂46', 'けやき坂46') and (it['d'], it['title']) in saku_keys)]
    items.sort(key=lambda it: (it['d'], it.get('t', '')), reverse=True)
    if items == old:
        print('no changes')
        return
    payload = {'updated': date.today().isoformat(), 'items': items}
    json.dump(payload, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    # トップページ用に直近分だけの軽量版も出す（全期間版は6MB超でトップ表示には重い）
    recent_path = os.path.join(BASE, 'data', 'news-recent.json')
    recent = {'updated': payload['updated'], 'items': items[:80]}
    old_recent = None
    if os.path.exists(recent_path):
        try:
            old_recent = json.load(open(recent_path, encoding='utf-8'))
        except Exception:
            old_recent = None
    if recent != old_recent:
        json.dump(recent, open(recent_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('wrote', len(items), 'items')


if __name__ == '__main__':
    sys.exit(main())
