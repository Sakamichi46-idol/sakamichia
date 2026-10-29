#!/usr/bin/env python3
"""欅坂46ブログの写真リスト補修。
新しい記事の写真は /files/14/diary/ ではなく /images/14/<dir>/<hash>(-NN).jpg 形式で
配信されており、初回取り込みの抽出から漏れた。keyaki_import.IMG_PAT は修正済みなので、
フィードを再巡回して parse_cards し直し、写真リストが増える記事だけ差し替える。
ログ: tools/repair-keyaki.log
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf
from keyaki_import import fetch_pc, parse_cards

FEED = 'https://www.keyakizaka46.com/s/k46o/diary/member/list'

LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'repair-keyaki.log')


def log(*a):
    line = time.strftime('%H:%M:%S') + ' ' + ' '.join(str(x) for x in a)
    print(line, flush=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def main():
    idx, years, imgs = bf.load_store()
    by_id = {}
    for y, recs in years.items():
        for b in recs:
            if b['id'].startswith('ofc-keya-'):
                by_id[b['id']] = b
    log('keyaki records:', len(by_id))
    upgraded = 0
    dirty = set()
    page, empty = 1, 0
    while True:
        url = f'{FEED}?ima=0000&page={page}&cd=member'
        try:
            html = fetch_pc(url)
        except Exception as e:
            log('fetch failed page', page, repr(e))
            time.sleep(5)
            try:
                html = fetch_pc(url)
            except Exception as e2:
                log('fetch failed twice; abort at page', page, repr(e2))
                break
        cards = parse_cards(html)
        if not cards:
            empty += 1
            log(f'page {page}: EMPTY ({empty}/2)')
            if empty >= 2:
                break
            page += 1
            continue
        empty = 0
        for c in cards:
            rid = f"ofc-keya-{c['detail']}"
            rec = by_id.get(rid)
            if rec is None:
                continue
            new = c['imgs']
            if len(new) > (rec.get('imgn') or 0):
                y = rec['date'][:4]
                imgs.setdefault(y, {})[rid] = new
                rec['imgn'] = len(new)
                if not rec.get('thumb'):
                    rec['thumb'] = new[0]
                dirty.add(y)
                upgraded += 1
        if page % 25 == 0:
            log(f'page {page}: upgraded so far {upgraded}')
            if dirty:
                bf.save_store(idx, years, imgs, set(dirty))
                dirty = set()
        page += 1
        time.sleep(0.8)
    if dirty:
        bf.save_store(idx, years, imgs, set(dirty))
    log(f'DONE pages={page} upgraded={upgraded}')


if __name__ == '__main__':
    main()
